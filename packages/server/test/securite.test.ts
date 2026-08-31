import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ENTETE_JETON } from '@previs/core';
import type { FastifyInstance } from 'fastify';
import { construireApplication, type Application } from '../src/index.js';
import type { Configuration } from '../src/config.js';
import { empreinteJeton, LimiteurConnexions } from '../src/securite.js';

/**
 * Essais de sécurité de l'API.
 *
 * Ils passent par `app.inject()` : aucun port n'est ouvert, aucun Chromium n'est
 * lancé, et la base vit en mémoire. Chaque essai verrouille une correction précise ;
 * un échec veut dire qu'une protection est tombée.
 */
const ORIGINE = 'https://previs.tarncompta.fr';

const config: Configuration = {
  port: 0,
  host: '127.0.0.1',
  urlPublique: ORIGINE,
  secretSession: 'secret-d-essai-suffisamment-long-pour-le-test',
  cheminBase: ':memory:',
  cheminStatique: '/chemin/qui-n-existe-pas',
  cheminChromium: '/usr/bin/chromium',
  cookiesSecurises: true,
  confianceProxy: 'loopback',
  niveauJournal: 'silent',
  mcpHttpActif: false,
  production: true,
  bootstrap: { email: '', motDePasse: '', nom: '' },
};

let application: Application;
let app: FastifyInstance;
let cookieAdmin = '';
let jetonAdmin = '';
let cookieLecteur = '';

const MOT_DE_PASSE = 'motdepasse-de-test-2026';

/**
 * Ouvre une session et renvoie le cookie.
 *
 * L'adresse est paramétrable : les essais qui saturent volontairement le compteur de
 * tentatives laisseraient sinon la boucle locale bloquée pour ceux qui les suivent.
 */
async function connecter(email: string, motDePasse: string, adresse?: string): Promise<string> {
  const reponse = await app.inject({
    method: 'POST',
    url: '/api/auth/connexion',
    headers: adresse ? { 'x-forwarded-for': adresse } : {},
    payload: { email, motDePasse },
  });
  expect(reponse.statusCode).toBe(200);
  const brut = reponse.headers['set-cookie'];
  const entete = Array.isArray(brut) ? brut[0] : (brut ?? '');
  return entete.split(';')[0];
}

beforeAll(async () => {
  application = await construireApplication(config);
  app = application.app;

  await application.auth.creerUtilisateur({
    email: 'admin@tarncompta.fr',
    nom: 'Administrateur',
    motDePasse: MOT_DE_PASSE,
    role: 'admin',
  });
  await application.auth.creerUtilisateur({
    email: 'lecteur@tarncompta.fr',
    nom: 'Lecteur',
    motDePasse: MOT_DE_PASSE,
    role: 'lecteur',
  });

  cookieAdmin = await connecter('admin@tarncompta.fr', MOT_DE_PASSE);
  cookieLecteur = await connecter('lecteur@tarncompta.fr', MOT_DE_PASSE);

  const reponse = await app.inject({
    method: 'POST',
    url: '/api/jetons',
    headers: { cookie: cookieAdmin, origin: ORIGINE },
    payload: { libelle: 'Essai', validiteJours: 1 },
  });
  expect(reponse.statusCode).toBe(200);
  jetonAdmin = reponse.json().jeton as string;
});

afterAll(async () => {
  await app.close();
});

describe('authentification', () => {
  it('une route de dossiers exige une identité', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/dossiers' });
    expect(reponse.statusCode).toBe(401);
  });

  it('un cookie de session inventé ne vaut rien', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { cookie: 'previs_session=jeton-invente-au-hasard' },
    });
    expect(reponse.statusCode).toBe(401);
  });

  it('l’identifiant de session n’est pas conservé en clair', async () => {
    const session = cookieAdmin.split('=')[1];
    const enClair = application.base
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?')
      .get(session) as { n: number };
    const hachee = application.base
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?')
      .get(empreinteJeton(session)) as { n: number };
    expect(enClair.n).toBe(0);
    expect(hachee.n).toBe(1);
  });

  it('le jeton d’API n’est pas conservé en clair', async () => {
    const enClair = application.base
      .prepare('SELECT COUNT(*) AS n FROM jetons WHERE empreinte = ?')
      .get(jetonAdmin) as { n: number };
    expect(enClair.n).toBe(0);
  });

  it('la route de santé ne révèle ni le nombre de dossiers ni celui des comptes', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
    expect(reponse.statusCode).toBe(200);
    expect(Object.keys(reponse.json()).sort()).toEqual(['etat', 'service']);
  });
});

describe('privilèges', () => {
  it('un jeton d’API n’ouvre pas l’administration, même pour un administrateur', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/utilisateurs',
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it('le même jeton lit et écrit bien les dossiers', async () => {
    const lecture = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(lecture.statusCode).toBe(200);
  });

  it('un compte en lecture seule ne peut pas créer de dossier', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { cookie: cookieLecteur, origin: ORIGINE },
      payload: { nom: 'Essai', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it('un collaborateur ne peut pas gérer les comptes', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/utilisateurs',
      headers: { cookie: cookieLecteur },
    });
    expect(reponse.statusCode).toBe(403);
  });
});

describe('requêtes intersites', () => {
  it('une écriture par cookie depuis une origine étrangère est refusée', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { cookie: cookieAdmin, origin: 'https://site-malveillant.example' },
      payload: { nom: 'Injecté', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it('une écriture par cookie sans en-tête Origin est refusée', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { cookie: cookieAdmin },
      payload: { nom: 'Injecté', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it('la même écriture depuis l’origine du service est acceptée', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { nom: 'Dossier légitime', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(200);
  });

  it('un appel par jeton d’API n’est pas soumis au contrôle d’origine', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin, origin: 'https://site-malveillant.example' },
      payload: { nom: 'Dossier assistant', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(200);
  });

  it('une lecture n’est jamais bloquée par le contrôle d’origine', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { cookie: cookieAdmin, origin: 'https://site-malveillant.example' },
    });
    expect(reponse.statusCode).toBe(200);
  });
});

describe('en-têtes de sécurité', () => {
  it('chaque réponse porte les en-têtes attendus', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
    expect(reponse.headers['x-content-type-options']).toBe('nosniff');
    expect(reponse.headers['x-frame-options']).toBe('DENY');
    expect(reponse.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(reponse.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(reponse.headers['content-security-policy'])).toContain("object-src 'none'");
  });

  it('HSTS est posé quand l’adresse publique est en HTTPS', async () => {
    /*
     * Sans HSTS, la première visite tapée « previs.tarncompta.fr » part en clair : un
     * intercepteur la garde en clair et lit la session. La redirection du frontal arrive
     * trop tard, la requête est déjà passée.
     */
    const reponse = await app.inject({ method: 'GET', url: '/api/sante' });
    expect(String(reponse.headers['strict-transport-security'])).toContain('max-age=31536000');
    expect(String(reponse.headers['strict-transport-security'])).toContain('includeSubDomains');
    // « preload » est un engagement du cabinet, pas du code.
    expect(String(reponse.headers['strict-transport-security'])).not.toContain('preload');
  });

  it('HSTS n’est pas posé sur un montage local en clair', async () => {
    const localE = await construireApplication({ ...config, urlPublique: 'http://127.0.0.1:8080' });
    try {
      const reponse = await localE.app.inject({ method: 'GET', url: '/api/sante' });
      expect(reponse.headers['strict-transport-security']).toBeUndefined();
    } finally {
      await localE.app.close();
      localE.base.close();
    }
  });
});

describe('énumération de comptes par le temps de réponse', () => {
  /*
   * La parade d'origine dérivait une empreinte de leurre à CHAQUE tentative sur un compte
   * inconnu, puis la comparait : deux dérivations scrypt là où un compte connu n'en coûte
   * qu'une. Mesuré avant correction, un compte inconnu répondait en 93,6 ms contre 47,6 —
   * 96,6 % d'écart, un oracle qu'on lit à l'œil nu. Après, 0,2 %.
   *
   * Le seuil est large — quarante pour cent — parce qu'une mesure de temps sous charge est
   * bruyante ; il attrape néanmoins un facteur deux, qui est ce qu'on veut interdire.
   */
  it('un compte inconnu ne répond pas plus lentement qu’un compte connu', async () => {
    const mesurer = async (email: string) => {
      // Un tour à blanc : la première dérivation paie l'initialisation.
      await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        headers: { origin: ORIGINE },
        payload: { email, motDePasse: 'mauvais-mot-de-passe-de-mesure' },
      });
      const temps: number[] = [];
      for (let i = 0; i < 6; i++) {
        const debut = performance.now();
        await app.inject({
          method: 'POST',
          url: '/api/auth/connexion',
          headers: { origin: ORIGINE, 'x-forwarded-for': `10.0.${i}.1` },
          payload: { email, motDePasse: 'mauvais-mot-de-passe-de-mesure' },
        });
        temps.push(performance.now() - debut);
      }
      temps.sort((a, b) => a - b);
      return temps[Math.floor(temps.length / 2)];
    };

    const connu = await mesurer('admin@tarncompta.fr');
    const inconnu = await mesurer('personne-de-ce-nom@tarncompta.fr');
    const ecart = Math.abs(inconnu - connu) / connu;
    expect(ecart, `connu ${connu.toFixed(1)} ms, inconnu ${inconnu.toFixed(1)} ms`).toBeLessThan(0.4);
  });
});

describe('limitation des tentatives', () => {
  it('la dixième tentative en échec depuis une même adresse est bloquée', async () => {
    let dernier = 0;
    for (let i = 0; i < 12; i++) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        payload: { email: 'admin@tarncompta.fr', motDePasse: `faux-mot-de-passe-${i}` },
      });
      dernier = reponse.statusCode;
    }
    expect(dernier).toBe(429);
  });
});

describe('le compteur de tentatives ne se remet pas à zéro à la demande', () => {
  /*
   * La purge d'origine vidait la table entière au-delà de dix mille clés. Dix mille adresses
   * inventées suffisaient donc à effacer le compteur du compte visé — et celui de l'adresse
   * de l'attaquant avec, puisqu'ils vivent dans la même table. Le commentaire de l'époque
   * s'en consolait en affirmant le contraire.
   *
   * L'éviction porte maintenant sur les compteurs les plus bas : ceux qui n'ont rien coûté.
   */
  it('un compteur élevé survit à dix mille clés inventées', () => {
    const limiteur = new LimiteurConnexions(10, 15 * 60 * 1000);
    const vise = 'compte:victime@tarncompta.fr';

    // La victime est à un essai du blocage.
    for (let i = 0; i < 9; i++) limiteur.echec(vise);
    expect(limiteur.bloque(vise)).toBe(false);

    // L'attaquant fait défiler des adresses inventées pour faire déborder la table.
    for (let i = 0; i < 12000; i++) limiteur.echec(`compte:inconnu-${i}@example.invalid`);

    // Le compteur de la victime doit avoir survécu : un essai de plus la bloque.
    limiteur.echec(vise);
    expect(limiteur.bloque(vise)).toBe(true);
  });

  it('la table reste bornée malgré le défilé d’adresses', () => {
    const limiteur = new LimiteurConnexions(10, 15 * 60 * 1000);
    for (let i = 0; i < 30000; i++) limiteur.echec(`compte:inconnu-${i}@example.invalid`);
    // On ne peut pas lire la taille depuis l'extérieur : on vérifie que la dernière clé
    // écrite est bien retenue, donc que la purge n'a pas tout jeté non plus.
    limiteur.echec('compte:inconnu-29999@example.invalid');
    expect(limiteur.bloque('compte:inconnu-29999@example.invalid')).toBe(false);
  });
});

describe('limitation par compte et adresse usurpée', () => {
  it('un essai réparti sur des adresses différentes bute sur le compteur du compte', async () => {
    let dernier = 0;
    for (let i = 0; i < 22; i++) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        // L'adresse distante est la boucle locale, seul réseau de confiance : c'est
        // donc bien l'en-tête transmis qui fait foi, et chaque essai part d'une adresse neuve.
        headers: { 'x-forwarded-for': `198.51.100.${i}` },
        payload: { email: 'lecteur@tarncompta.fr', motDePasse: `faux-${i}` },
      });
      dernier = reponse.statusCode;
    }
    expect(dernier).toBe(429);
  });

  it('une adresse transmise par un client non approuvé est ignorée', async () => {
    // La requête vient d'Internet, pas du proxy : l'en-tête est écarté et les essais
    // s'accumulent bien sur la même adresse, malgré les valeurs déclarées.
    let dernier = 0;
    for (let i = 0; i < 12; i++) {
      const reponse = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        remoteAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': `192.0.2.${i}` },
        payload: { email: 'inconnu@tarncompta.fr', motDePasse: `faux-${i}` },
      });
      dernier = reponse.statusCode;
    }
    expect(dernier).toBe(429);
  });
});

describe('changement de mot de passe', () => {
  it('la vérification n’ouvre pas de session parasite et ferme les sessions ouvertes', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'change@tarncompta.fr',
      nom: 'Change',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connecter('change@tarncompta.fr', MOT_DE_PASSE, '198.51.100.200');
    const sessions = () =>
      (
        application.base
          .prepare('SELECT COUNT(*) AS n FROM sessions WHERE utilisateur_id = ?')
          .get(compte.id) as { n: number }
      ).n;
    expect(sessions()).toBe(1);

    const echec = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: 'mauvais-mot-de-passe', nouveau: 'nouveau-mot-de-passe-2026' },
    });
    expect(echec.statusCode).toBe(401);
    expect(sessions()).toBe(1);

    const succes = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'nouveau-mot-de-passe-2026' },
    });
    expect(succes.statusCode).toBe(200);
    expect(sessions()).toBe(0);
  });
});

describe('comptes', () => {
  it('le dernier administrateur actif ne peut pas être rétrogradé', async () => {
    const comptes = await app.inject({
      method: 'GET',
      url: '/api/utilisateurs',
      headers: { cookie: cookieAdmin },
    });
    const admin = (comptes.json() as Array<{ id: string; role: string }>).find(
      (u) => u.role === 'admin',
    )!;

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${admin.id}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { role: 'collaborateur' },
    });
    expect(reponse.statusCode).toBe(422);
    expect(application.auth.compterAdministrateurs()).toBe(1);
  });

  it('le dernier administrateur actif ne peut pas être désactivé', async () => {
    const admin = application.auth
      .listerUtilisateurs()
      .find((u) => u.role === 'admin' && u.actif)!;
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${admin.id}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { actif: false },
    });
    expect(reponse.statusCode).toBe(422);
  });
});

describe('erreurs', () => {
  it('une charge utile invalide ne divulgue pas le détail interne', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { nom: '' },
    });
    expect(reponse.statusCode).toBe(422);
    expect(reponse.json().code).toBe('donnees_invalides');
  });
});

describe('le jeton d’API par « Authorization: Bearer »', () => {
  it('authentifie comme l’en-tête propre au logiciel', async () => {
    const parEnTetePropre = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    const parBearer = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { authorization: `Bearer ${jetonAdmin}` },
    });
    expect(parEnTetePropre.statusCode).toBe(200);
    expect(parBearer.statusCode).toBe(200);
  });

  it('la casse et les espaces du préfixe sont tolérés', async () => {
    for (const valeur of [`bearer ${jetonAdmin}`, `BEARER  ${jetonAdmin}`, `Bearer ${jetonAdmin} `]) {
      const r = await app.inject({
        method: 'GET',
        url: '/api/dossiers',
        headers: { authorization: valeur },
      });
      expect(r.statusCode, valeur).toBe(200);
    }
  });

  it('dispense du contrôle d’origine, comme l’en-tête propre', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: {
        authorization: `Bearer ${jetonAdmin}`,
        origin: 'https://site-malveillant.example',
      },
      payload: { nom: 'Dossier par Bearer', modele: 'vide' },
    });
    expect(reponse.statusCode).toBe(200);
  });

  it('n’ouvre pas davantage l’administration que l’autre en-tête', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: '/api/utilisateurs',
      headers: { authorization: `Bearer ${jetonAdmin}` },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it('un jeton inventé et un en-tête mal formé sont refusés', async () => {
    for (const valeur of ['Bearer previs_inexistant', 'Basic abcdef', 'Bearer', ''] as const) {
      const r = await app.inject({
        method: 'GET',
        url: '/api/dossiers',
        headers: valeur ? { authorization: valeur } : {},
      });
      expect(r.statusCode, valeur || '(aucun)').toBe(401);
    }
  });
});

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  completerLigne,
  ENTETE_JETON,
  modeleDossier,
  normaliserDossier,
} from '@previs/core';

/** Le plus petit PNG valable : un pixel. Le contrôle du logo lit les octets. */
const PNG_MINIMAL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42m' +
  'NkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
import type { FastifyInstance } from 'fastify';
import { construireApplication, type Application } from '../src/index.js';
import type { Configuration } from '../src/config.js';
import { empreinteJeton, LimiteurConnexions, LimiteurDebit } from '../src/securite.js';
import { bornerExportPdf } from '../src/mcpHttp.js';
import { avecDelai, FileImpressions } from '../src/pdf/file.js';

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

describe('l’export PDF est plafonné sur les deux canaux', () => {
  const AUTEUR_ESSAI = { id: 'utl_1', nom: 'Aymeric HANGARD', origine: 'mcp' } as const;

  /** Un dépôt factice : seule `pdf` compte ici, et elle ne lance pas Chromium. */
  function depotFactice() {
    const appels: string[] = [];
    const faux = {
      appels,
      async pdf(id: string) {
        appels.push(id);
        return new Uint8Array([1, 2, 3]);
      },
      async lire(id: string) {
        return { id } as never;
      },
    };
    return faux;
  }

  it('l’outil MCP puise dans le même compteur que la route HTTP', async () => {
    const debit = new LimiteurDebit(3, 60_000);
    const brut = depotFactice();
    const borne = bornerExportPdf(brut as never, () => debit.autoriser('utl_1'));

    await borne.pdf('dos_1', AUTEUR_ESSAI);
    await borne.pdf('dos_1', AUTEUR_ESSAI);
    await borne.pdf('dos_1', AUTEUR_ESSAI);
    expect(brut.appels).toHaveLength(3);

    // Le quatrième dépasse le plafond : refusé avant d'atteindre Chromium.
    await expect(borne.pdf('dos_1', AUTEUR_ESSAI)).rejects.toThrow(/Trop d’exports PDF/);
    expect(brut.appels).toHaveLength(3);

    // Et le compteur est bien celui de la route : elle n'a plus rien à donner non plus.
    expect(debit.autoriser('utl_1')).toBe(false);
  });

  it('le refus porte le code « interdit », pas une erreur interne', async () => {
    const borne = bornerExportPdf(depotFactice() as never, () => false);
    await expect(borne.pdf('dos_1', AUTEUR_ESSAI)).rejects.toMatchObject({
      name: 'ErreurDepot',
      code: 'interdit',
    });
  });

  it('le plafond est par titulaire : un compte n’épuise pas celui d’un autre', async () => {
    const debit = new LimiteurDebit(1, 60_000);
    const premier = bornerExportPdf(depotFactice() as never, () => debit.autoriser('utl_1'));
    const second = bornerExportPdf(depotFactice() as never, () => debit.autoriser('utl_2'));

    await premier.pdf('dos_1', AUTEUR_ESSAI);
    await expect(premier.pdf('dos_1', AUTEUR_ESSAI)).rejects.toThrow();
    await expect(second.pdf('dos_1', AUTEUR_ESSAI)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('tout le reste du dépôt passe sans être recopié', async () => {
    const brut = depotFactice();
    const borne = bornerExportPdf(brut as never, () => true);
    // `lire` n'est pas redéfinie : elle doit rester atteignable par le prototype, sans
    // quoi le serveur MCP perdrait une méthode à chaque ajout au dépôt.
    await expect(borne.lire('dos_7')).resolves.toEqual({ id: 'dos_7' });
  });
});

describe('la file d’impression borne Chromium', () => {
  it('ne laisse jamais passer plus que le plafond, même sur un passage de main', async () => {
    const file = new FileImpressions(2, 12);
    await file.prendre();
    await file.prendre();
    expect(file.occupees).toBe(2);

    // Trois demandes en attente derrière les deux jetons.
    const attentes = [file.prendre(), file.prendre(), file.prendre()];
    await Promise.resolve();
    expect(file.enFile).toBe(3);

    /*
     * Le point exact que la première version manquait : rendre un jeton réveille le
     * premier de la file par une micro-tâche. Un appelant qui se présente dans cet
     * intervalle ne doit PAS trouver de place libre — sinon trois Chromium tournent là
     * où le plafond en promet deux.
     */
    file.rendre();
    const intrus = file.prendre();
    let intrusServi = false;
    void intrus.then(() => {
      intrusServi = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(file.occupees).toBe(2);
    expect(intrusServi).toBe(false);

    // Puis tout se déroule dans l'ordre, sans jamais dépasser deux.
    for (let i = 0; i < 4; i++) {
      file.rendre();
      await Promise.resolve();
      await Promise.resolve();
      expect(file.occupees).toBeLessThanOrEqual(2);
    }
    await Promise.all([...attentes, intrus]);
  });

  it('refuse au-delà de la file d’attente plutôt que de faire patienter sans fin', async () => {
    const file = new FileImpressions(1, 2);
    await file.prendre();
    const attentes = [file.prendre(), file.prendre()];
    await Promise.resolve();
    await expect(file.prendre()).rejects.toThrow(/Trop d’exports simultanés/);

    file.rendre();
    file.rendre();
    file.rendre();
    await Promise.all(attentes);
  });

  it('rend son jeton quand l’impression échoue', async () => {
    const file = new FileImpressions(1, 2);
    // C'est le « finally » de genererPdf qui rend le jeton ; on en reproduit le contrat.
    try {
      await file.prendre();
      throw new Error('Chromium a refusé');
    } catch {
      file.rendre();
    }
    expect(file.occupees).toBe(0);
    await expect(file.prendre()).resolves.toBeUndefined();
  });
});

describe('le délai d’impression', () => {
  it('abandonne une impression qui ne rend jamais la main', async () => {
    const jamais = new Promise<Uint8Array>(() => undefined);
    await expect(avecDelai(jamais, 20)).rejects.toThrow(/dépassé 0 secondes|dépassé \d+ seconde/);
  });

  it('laisse passer une impression qui aboutit à temps', async () => {
    const vite = Promise.resolve(new Uint8Array([1]));
    await expect(avecDelai(vite, 1000)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('n’abat pas le processus quand la promesse abandonnée rejette ensuite', async () => {
    let rejeter: (e: Error) => void = () => undefined;
    const tardive = new Promise<Uint8Array>((_, r) => {
      rejeter = r;
    });
    await expect(avecDelai(tardive, 20)).rejects.toThrow();
    // Le rejet arrive après l'abandon : sans le « catch » vide d'avecDelai, c'est un
    // « unhandledRejection », et le service tombe.
    rejeter(new Error('Chromium fermé'));
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('ce qu’un anonyme peut faire coûter au serveur', () => {
  /*
   * Le plafond de corps global était de seize mégaoctets, et c'est la SEULE borne qu'un
   * point d'entrée anonyme rencontre avant l'analyse de son corps : la limitation de débit,
   * elle, vit dans le gestionnaire, donc après. Pire, `@fastify/compress` est enregistré
   * globalement et pose un crochet de DÉCOMPRESSION sur chaque route — mesuré, 14 625
   * octets de gzip se détendaient en 14,3 Mo et coûtaient 110 à 134 ms de boucle
   * d'événements bloquée, sur une adresse dont le compteur répondait déjà 429.
   */
  const ANONYMES = [
    '/api/auth/connexion',
    '/api/auth/cles/connexion/options',
    '/api/auth/cles/connexion',
  ] as const;

  it('un corps démesuré est refusé avant d’être analysé', async () => {
    const enorme = JSON.stringify({ reponse: 'A'.repeat(2_000_000) });
    for (const url of ANONYMES) {
      const r = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: enorme,
      });
      expect(r.statusCode, url).toBe(413);
    }
  });

  it('un corps comprimé n’est pas détendu sur un point d’entrée anonyme', async () => {
    const charge = Buffer.from(JSON.stringify({ reponse: 'A'.repeat(15_000_000) }));
    const bombe = gzipSync(charge);
    // Le rapport est ce qui fait l'attaque : quelques kilo-octets pour quinze mégaoctets.
    expect(charge.length / bombe.length).toBeGreaterThan(500);

    for (const url of ANONYMES) {
      const debut = performance.now();
      const r = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        payload: bombe,
      });
      const cout = performance.now() - debut;
      // Ni 200 ni un traitement : la requête est écartée sur son encodage.
      expect(r.statusCode, url).toBe(400);
      // Et surtout, elle ne coûte pas le prix de la détente. Le seuil est large : ce qui
      // est éprouvé est l'ordre de grandeur, 1 ms contre 110.
      expect(cout, `${url} : ${cout.toFixed(0)} ms`).toBeLessThan(40);
    }
  });

  it('et le plafond global couvre aussi les routes authentifiées', async () => {
    // Le plafond par route ne protège que les routes qu'on a pensé à munir. Celui-ci
    // couvre toutes les autres, y compris celles qu'on ajoutera : deux mégaoctets sur
    // une route qui n'a rien à voir avec un dossier doivent être refusés.
    const enorme = JSON.stringify({ libelle: 'A'.repeat(2_000_000), validiteJours: 1 });
    const r = await app.inject({
      method: 'POST',
      url: '/api/jetons',
      headers: { cookie: cookieAdmin, origin: ORIGINE, 'content-type': 'application/json' },
      payload: enorme,
    });
    expect(r.statusCode).toBe(413);
  });

  it('le trafic ordinaire de ces routes passe toujours', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      headers: { origin: ORIGINE },
      payload: { email: 'inconnu@tarncompta.fr', motDePasse: MOT_DE_PASSE },
      remoteAddress: '10.9.9.9',
    });
    expect(r.statusCode).toBe(401);
  });

  it('les routes qui portent un dossier acceptent un corps plus large', async () => {
    // Un dossier réel de cinq cents lignes pèse 125 Ko : il doit passer sans discussion.
    const gros = normaliserDossier({
      ...modeleDossier('IS'),
      charges: {
        ...modeleDossier('IS').charges,
        lignes: Array.from({ length: 500 }, (_, i) =>
          completerLigne('charges.lignes', {
            id: `c${i}`,
            libelle: `Charge ${i}`,
            montants: [1000, 1100, 1200],
          }),
        ),
      },
    });
    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Cinq cents lignes', modele: 'IS' },
    });
    const r = await app.inject({
      method: 'PUT',
      url: `/api/dossiers/${cree.json().id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { dossier: gros, versionAttendue: 1 },
    });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  });
});

describe('l’ampleur d’un dossier est bornée dans son ensemble', () => {
  /*
   * `LIGNES_MAX` est posé par LISTE, et il y a douze listes adressables : à lui seul, il
   * laissait passer un dossier de vingt mégaoctets dont chaque plafond documenté était
   * pourtant respecté. Le relire coûtait 688 ms, le modifier d'une opération triviale
   * 1 269 ms, et l'historique en gardait cent copies.
   */
  it('un dossier trop lourd est refusé, en disant pourquoi', async () => {
    const modele = modeleDossier('IS');
    const lourd = normaliserDossier({
      ...modele,
      charges: {
        ...modele.charges,
        lignes: Array.from({ length: 500 }, (_, i) =>
          completerLigne('charges.lignes', {
            id: `c${i}`,
            libelle: `Charge ${i}`.padEnd(200, 'x'),
            note: 'n'.repeat(2000),
            montants: [1000, 1000, 1000],
            repartition: {
              type: 'mensuel',
              montants: Array.from({ length: 10 }, () => Array.from({ length: 24 }, () => 83.33)),
            },
          }),
        ),
      },
    });
    expect(JSON.stringify(lourd).length).toBeGreaterThan(1_500_000);

    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Dossier hors normes', modele: 'IS' },
    });
    const r = await app.inject({
      method: 'PUT',
      url: `/api/dossiers/${cree.json().id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { dossier: lourd, versionAttendue: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().erreur).toMatch(/Ko, pour un maximum de/);
  });

  it('la création est bornée elle aussi : elle accepte un dossier complet', async () => {
    const modele = modeleDossier('IS');
    const trop = normaliserDossier({
      ...modele,
      charges: {
        ...modele.charges,
        lignes: Array.from({ length: 500 }, (_, i) =>
          completerLigne('charges.lignes', {
            id: `c${i}`,
            libelle: 'x'.repeat(200),
            note: 'n'.repeat(2000),
            montants: [1000, 1000, 1000],
            repartition: {
              type: 'mensuel',
              montants: Array.from({ length: 10 }, () => Array.from({ length: 24 }, () => 83.33)),
            },
          }),
        ),
      },
    });
    expect(JSON.stringify(trop).length).toBeGreaterThan(1_500_000);
    const r = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Créé trop gros', dossier: trop },
    });
    expect(r.statusCode).toBe(422);
  });
});

describe('la liste des dossiers ne porte pas les logos', () => {
  /*
   * Un logo pèse jusqu'à 700 000 caractères de base64, et la liste d'accueil les servait
   * tous, à chaque affichage, alors qu'aucun écran ne s'en sert. Mesuré : vingt dossiers
   * portant un logo de 626 Ko donnaient 12,2 Mo de réponse, contre 5,8 Ko sans eux.
   */
  it('elle dit qu’un logo existe, sans le transmettre', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Avec logo', modele: 'IS' },
    });
    const id = cree.json().id as string;
    const pose = await app.inject({
      method: 'PUT',
      url: `/api/dossiers/${id}/logo`,
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { logo: PNG_MINIMAL },
    });
    expect(pose.statusCode, pose.body.slice(0, 200)).toBe(200);

    const liste = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    const resume = (liste.json() as Array<Record<string, unknown>>).find((d) => d.id === id)!;
    expect(resume.aUnLogo).toBe(true);
    expect(resume).not.toHaveProperty('logo');
    expect(liste.body).not.toContain(PNG_MINIMAL.slice(30, 60));

    // Le dossier complet, lui, le porte : c'est de là que l'écran et le PDF le lisent.
    const complet = await app.inject({
      method: 'GET',
      url: `/api/dossiers/${id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(complet.json().logo).toBe(PNG_MINIMAL);
    expect(complet.json().aUnLogo).toBe(true);
  });
});

describe('rien de ce que sert l’API n’est mis en cache', () => {
  /*
   * Un dossier prévisionnel porte le chiffre d'affaires, la masse salariale et la
   * trésorerie d'un client réel. Sans « cache-control: no-store », un mandataire
   * d'entreprise, un cache partagé ou le disque d'un poste emprunté en gardent une copie
   * que rien ne réclame ensuite.
   */
  it('les routes de données portent « no-store »', async () => {
    for (const url of ['/api/dossiers', '/api/sante', '/api/cabinet']) {
      const r = await app.inject({ method: 'GET', url, headers: { [ENTETE_JETON]: jetonAdmin } });
      expect(r.headers['cache-control'], url).toBe('no-store, private');
    }
  });

  it('y compris la réponse qui porte le dossier lui-même', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Sans cache', modele: 'IS' },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/dossiers/${cree.json().id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(r.headers['cache-control']).toBe('no-store, private');
  });
});

describe('la suppression d’un dossier client laisse une trace nominative', () => {
  /*
   * C'est la seule opération irréversible du dépôt, et elle inscrivait un nom
   * d'utilisateur VIDE dans le journal : la suppression du dossier d'un client était la
   * seule action qu'aucune enquête ne pouvait rattacher à quelqu'un.
   */
  it('le journal nomme qui a supprimé, et par quel canal', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'À supprimer', modele: 'IS' },
    });
    const id = cree.json().id as string;
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/dossiers/${id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(r.statusCode).toBe(200);

    const trace = application.base
      .prepare(
        "SELECT utilisateur, origine, detail FROM journal_audit WHERE action = 'suppression_dossier' AND cible = ?",
      )
      .get(id) as { utilisateur: string; origine: string; detail: string } | undefined;
    expect(trace).toBeTruthy();
    expect(trace!.utilisateur).toBe('Administrateur');
    expect(trace!.origine).toBe('mcp');
    expect(trace!.detail).toBe('À supprimer');
  });
});

describe('une erreur imprévue ne raconte rien de l’installation', () => {
  /*
   * `repondreErreur` prend soin de masquer l'imprévu en production, mais quinze routes
   * n'avaient pas de bloc `try/catch` et ne passaient donc jamais par elle. Le gestionnaire
   * par défaut de Fastify recopiait alors le message brut : mesuré,
   * « SQLITE_ERROR: no such column: x — /opt/previs/data/previs.db ». Un compte en lecture
   * seule, ou un assistant connecté par OAuth, obtenait le chemin de la base et le fragment
   * SQL fautif ; sur le chemin zod, le vidage des anomalies, avec la valeur trouvée dans le
   * dossier d'un client.
   */
  it('une panne interne ne rend ni chemin de fichier ni fragment SQL', async () => {
    // Une route SANS bloc try/catch — il y en avait quinze — que l'on fait échouer au
    // niveau du moteur SQL. Sans gestionnaire global, Fastify recopiait le message :
    // « SQLITE_ERROR: no such column: x — /opt/previs/data/previs.db ».
    application.base.exec('ALTER TABLE dossiers RENAME TO dossiers_deplacee');
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/api/dossiers',
        headers: { [ENTETE_JETON]: jetonAdmin },
      });
      expect(r.statusCode).toBe(500);
      expect(r.json().code).toBe('erreur_interne');
      expect(r.body).not.toMatch(/SQLITE|no such table|dossiers_deplacee|\.db/);
      // La forme du contrat, et non « {statusCode, error, message} ».
      expect(r.json()).not.toHaveProperty('statusCode');
    } finally {
      application.base.exec('ALTER TABLE dossiers_deplacee RENAME TO dossiers');
    }
  });

  it('un dossier illisible rend 422, et non un 500 nu', async () => {
    const cree = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin },
      payload: { nom: 'Écrit par une version antérieure', modele: 'IS' },
    });
    const id = cree.json().id as string;

    // Un contenu tel qu'en produirait une version antérieure du modèle : le régime porte
    // une valeur que le schéma actuel ne connaît plus. `GET /api/dossiers/:id` n'avait pas
    // de try/catch et rendait la ZodError sérialisée dans un 500.
    const contenu = JSON.parse(
      (application.base.prepare('SELECT contenu FROM dossiers WHERE id = ?').get(id) as {
        contenu: string;
      }).contenu,
    ) as { identite: { regime: string } };
    contenu.identite.regime = 'IS_ANCIEN_REGIME';
    application.base
      .prepare('UPDATE dossiers SET contenu = ? WHERE id = ?')
      .run(JSON.stringify(contenu), id);

    const r = await app.inject({
      method: 'GET',
      url: `/api/dossiers/${id}`,
      headers: { [ENTETE_JETON]: jetonAdmin },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('donnees_invalides');
    expect(r.json().erreur).toBe('Les données transmises ne respectent pas le format attendu.');
  });

  it('les erreurs de transport gardent leur statut et la forme du contrat', async () => {
    const malforme = await app.inject({
      method: 'POST',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonAdmin, 'content-type': 'application/json' },
      payload: '{"nom": ',
    });
    expect(malforme.statusCode).toBe(400);
    // La forme que l'interface sait lire, et non « {statusCode, error, message} ».
    expect(malforme.json()).toHaveProperty('erreur');
    expect(malforme.json()).toHaveProperty('code');
    expect(malforme.json()).not.toHaveProperty('statusCode');
  });
});

describe('un administrateur ne change pas son propre mot de passe sans l’ancien', () => {
  /*
   * La septième règle du projet, prise par l'autre bout. `POST /api/auth/motdepasse` exige
   * le mot de passe actuel ; `PATCH /api/utilisateurs/:id` ne l'exigeait pas, pour aucun
   * compte — y compris celui de l'appelant. Une session d'administrateur dérobée se
   * convertissait donc en deux requêtes : un mot de passe choisi, puis une connexion
   * normale. Le titulaire légitime, lui, se retrouvait verrouillé hors de son compte.
   */
  async function moi(): Promise<string> {
    const r = await app.inject({ method: 'GET', url: '/api/auth/moi', headers: { cookie: cookieAdmin } });
    return r.json().utilisateur.id as string;
  }

  it('sans « ancien », le changement est refusé', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${await moi()}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { motDePasse: 'un-mot-de-passe-choisi-par-le-voleur' },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('identifiant_refuse');

    // Et l'ancien mot de passe fonctionne toujours : rien n'a été changé.
    const connexion = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: 'admin@tarncompta.fr', motDePasse: MOT_DE_PASSE },
      remoteAddress: '10.8.8.1',
    });
    expect(connexion.statusCode).toBe(200);
  });

  it('avec un « ancien » faux, il est refusé aussi', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${await moi()}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { motDePasse: 'un-autre-mot-de-passe-choisi', ancien: 'ce-n-est-pas-le-bon' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('les autres champs du compte restent modifiables sans mot de passe', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${await moi()}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { nom: 'Aymeric HANGARD' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().nom).toBe('Aymeric HANGARD');
  });

  it('et réinitialiser le mot de passe d’un AUTRE compte reste possible, en le disant', async () => {
    const cible = await app.inject({
      method: 'POST',
      url: '/api/utilisateurs',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: {
        email: 'collegue@tarncompta.fr',
        nom: 'Collègue',
        motDePasse: 'motdepasse-du-collegue-2026',
        role: 'collaborateur',
      },
    });
    const id = cible.json().id as string;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${id}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { motDePasse: 'mot-de-passe-reinitialise-2026' },
    });
    expect(r.statusCode).toBe(200);

    // Le journal dit ce que le changement ne referme PAS.
    const trace = application.base
      .prepare(
        "SELECT detail FROM journal_audit WHERE action = 'modification_compte' AND cible = ? ORDER BY id DESC",
      )
      .get(id) as { detail: string } | undefined;
    expect(trace!.detail).toMatch(/clés d’accès du compte survivent/);
    expect(trace!.detail).not.toContain('ancien');
  });
});

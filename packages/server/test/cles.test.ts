import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ENTETE_JETON } from '@previs/core';
import { construireApplication, type Application } from '../src/index.js';
import type { Configuration } from '../src/config.js';
import { partieDeConfiance } from '../src/cles.js';
import { AuthentificateurFactice } from './authentificateur.js';

/**
 * Clés d'accès (WebAuthn).
 *
 * Chaque essai met en défaut une protection précise. Un authentificateur factice tient
 * le rôle du téléphone ou de la clé matérielle : il signe pour de vrai, et sait aussi
 * mal se comporter — signer pour une autre origine, omettre la vérification du porteur,
 * faire régresser son compteur. Un contrôle qu'on ne peut pas mettre en défaut n'est
 * pas éprouvé.
 */
const ORIGINE = 'https://previs.tarncompta.fr';
const RP_ID = 'previs.tarncompta.fr';
const MOT_DE_PASSE = 'motdepasse-de-test-2026';

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
let idAdmin = '';

/** Chaque essai parle depuis sa propre adresse : les limiteurs sont partagés. */
function depuis(adresse: string): Record<string, string> {
  return { 'x-forwarded-for': adresse, origin: ORIGINE };
}

async function connexionParMotDePasse(email: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/connexion',
    headers: { 'x-forwarded-for': '198.51.100.1' },
    payload: { email, motDePasse: MOT_DE_PASSE },
  });
  const brut = r.headers['set-cookie'];
  return (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
}

/** Ouvre une cérémonie d'enregistrement et rend le défi et son identifiant. */
async function ouvrirEnregistrement(
  cookie: string,
  adresse = '198.51.100.2',
): Promise<{ demande: string; defi: string; statut: number; corps: unknown }> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/cles/enregistrement',
    headers: { cookie, ...depuis(adresse) },
    payload: { motDePasse: MOT_DE_PASSE },
  });
  const corps = r.json() as { demande?: string; options?: { challenge?: string } };
  return {
    demande: corps.demande ?? '',
    defi: corps.options?.challenge ?? '',
    statut: r.statusCode,
    corps,
  };
}

/**
 * Enregistre une clé de bout en bout et rend l'authentificateur qui la porte.
 *
 * L'aide échoue si l'enregistrement n'a pas abouti. Sans cela, un essai qui attend un
 * refus passerait alors que la clé n'a jamais existé — ce qui s'est produit : le compte
 * partagé avait atteint son plafond de dix clés, et quatre essais passaient à vide.
 */
async function enregistrerCle(
  cookie: string,
  graine: number,
  libelle = 'iPhone du cabinet',
): Promise<{ authentificateur: AuthentificateurFactice; statut: number; corps: never }> {
  const { demande, defi, statut: statutOuverture } = await ouvrirEnregistrement(cookie);
  if (statutOuverture !== 200) {
    throw new Error(`Ouverture de la cérémonie refusée (${statutOuverture}) — essai non concluant.`);
  }
  const authentificateur = new AuthentificateurFactice(graine);
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/cles',
    headers: { cookie, ...depuis('198.51.100.2') },
    payload: {
      demande,
      libelle,
      reponse: authentificateur.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID }),
    },
  });
  if (r.statusCode !== 200) {
    throw new Error(`Enregistrement refusé (${r.statusCode}) : ${r.body} — essai non concluant.`);
  }
  return { authentificateur, statut: r.statusCode, corps: r.json() as never };
}

/**
 * Un compte neuf portant une clé neuve.
 *
 * Chaque essai de connexion a le sien : partager un compte fait buter les derniers sur
 * le plafond de dix clés, et un enregistrement qui échoue rend l'essai muet.
 */
let compteurComptes = 0;
async function compteAvecCle(
  graine: number,
): Promise<{ cookie: string; authentificateur: AuthentificateurFactice; id: string; email: string }> {
  compteurComptes += 1;
  const email = `cle${compteurComptes}@tarncompta.fr`;
  const compte = await application.auth.creerUtilisateur({
    email,
    nom: `Porteur ${compteurComptes}`,
    motDePasse: MOT_DE_PASSE,
    role: 'collaborateur',
  });
  const cookie = await connexionParMotDePasse(email);
  const { authentificateur } = await enregistrerCle(cookie, graine);
  // Une clé découvrable rapporte l'identifiant du compte : l'authentificateur factice
  // fait de même, sans quoi la connexion serait refusée à bon droit.
  authentificateur.porteur = compte.id;
  return { cookie, authentificateur, id: compte.id, email };
}

/** Ouvre une cérémonie de connexion. */
async function ouvrirConnexion(adresse: string): Promise<{ demande: string; defi: string; corps: never }> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/cles/connexion/options',
    headers: { 'x-forwarded-for': adresse },
  });
  const corps = r.json() as { demande?: string; options?: { challenge?: string } };
  return { demande: corps.demande ?? '', defi: corps.options?.challenge ?? '', corps: corps as never };
}

beforeAll(async () => {
  application = await construireApplication(config);
  app = application.app;
  await application.auth.creerUtilisateur({
    email: 'collab@tarncompta.fr',
    nom: 'Collaborateur',
    motDePasse: MOT_DE_PASSE,
    role: 'collaborateur',
  });
  const admin = await application.auth.creerUtilisateur({
    email: 'admin@tarncompta.fr',
    nom: 'Admin',
    motDePasse: MOT_DE_PASSE,
    role: 'admin',
  });
  idAdmin = admin.id;
});

afterAll(async () => {
  await app.close();
});

describe('partie de confiance', () => {
  it('l’identifiant et l’origine viennent de l’adresse publique, jamais de la requête', () => {
    const p = partieDeConfiance('https://previs.tarncompta.fr');
    expect(p.rpID).toBe('previs.tarncompta.fr');
    expect(p.origines).toEqual(['https://previs.tarncompta.fr']);
    expect(p.actives).toBe(true);
  });

  it('en production les ports de développement ne sont jamais ajoutés', () => {
    const p = partieDeConfiance('https://previs.tarncompta.fr');
    expect(p.origines.some((o) => o.includes('5173'))).toBe(false);
    expect(p.origines.some((o) => o.startsWith('http://'))).toBe(false);
  });

  it('sur la boucle locale, et là seulement, les ports de développement sont acceptés', () => {
    const p = partieDeConfiance('http://localhost:8080');
    expect(p.actives).toBe(true);
    expect(p.origines).toContain('http://localhost:8080');
    expect(p.origines).toContain('http://localhost:5173');
  });

  it('une adresse publique en clair hors boucle locale désactive les clés', () => {
    const p = partieDeConfiance('http://previs.tarncompta.fr');
    expect(p.actives).toBe(false);
    expect(p.motif).toContain('https');
  });
});

describe('enregistrement d’une clé', () => {
  it('le flux complet enregistre une clé, visible sur le compte', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const { statut, corps } = await enregistrerCle(cookie, 1);
    expect(statut).toBe(200);
    expect((corps as { libelle: string }).libelle).toBe('iPhone du cabinet');

    const liste = await app.inject({ method: 'GET', url: '/api/auth/cles', headers: { cookie } });
    expect(liste.statusCode).toBe(200);
    expect(liste.json().cles).toHaveLength(1);
    expect(liste.json().actives).toBe(true);
  });

  it('le mot de passe actuel est exigé : une session dérobée ne pose pas de clé', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/enregistrement',
      headers: { cookie, ...depuis('198.51.100.3') },
      payload: { motDePasse: 'ce-n-est-pas-le-bon' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('un jeton d’API n’enregistre pas de clé', async () => {
    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const jeton = (
      await app.inject({
        method: 'POST',
        url: '/api/jetons',
        headers: { cookie: cookieAdmin, origin: ORIGINE },
        payload: { libelle: 'Essai', validiteJours: 1 },
      })
    ).json().jeton as string;

    for (const chemin of ['/api/auth/cles/enregistrement', '/api/auth/cles']) {
      const r = await app.inject({
        method: 'POST',
        url: chemin,
        headers: { [ENTETE_JETON]: jeton },
        payload: { motDePasse: MOT_DE_PASSE, demande: 'x', reponse: {} },
      });
      expect(r.statusCode, chemin).toBe(403);
    }
    const liste = await app.inject({
      method: 'GET',
      url: '/api/auth/cles',
      headers: { [ENTETE_JETON]: jeton },
    });
    expect(liste.statusCode).toBe(403);
  });

  it('un défi d’enregistrement ne sert qu’une fois', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const { demande, defi } = await ouvrirEnregistrement(cookie);
    const premier = new AuthentificateurFactice(20);
    const rejeu = new AuthentificateurFactice(21);

    const un = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie, ...depuis('198.51.100.4') },
      payload: { demande, libelle: 'Une', reponse: premier.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(un.statusCode).toBe(200);

    const deux = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie, ...depuis('198.51.100.4') },
      payload: { demande, libelle: 'Deux', reponse: rejeu.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(deux.statusCode).toBe(400);
  });

  it('une clé enregistrée sans vérification du porteur est refusée', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const { demande, defi } = await ouvrirEnregistrement(cookie);
    const sansCode = new AuthentificateurFactice(30);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie, ...depuis('198.51.100.5') },
      payload: {
        demande,
        libelle: 'Sans code',
        reponse: sansCode.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID, verifie: false }),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('une origine étrangère est refusée à l’enregistrement', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const { demande, defi } = await ouvrirEnregistrement(cookie);
    const ailleurs = new AuthentificateurFactice(31);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie, ...depuis('198.51.100.6') },
      payload: {
        demande,
        libelle: 'Ailleurs',
        reponse: ailleurs.enregistrer({ defi, origine: 'https://previs.attaquant.fr', rpId: RP_ID }),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('un identifiant de partie de confiance étranger est refusé', async () => {
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const { demande, defi } = await ouvrirEnregistrement(cookie);
    const autreDomaine = new AuthentificateurFactice(32);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie, ...depuis('198.51.100.7') },
      payload: {
        demande,
        libelle: 'Autre domaine',
        reponse: autreDomaine.enregistrer({ defi, origine: ORIGINE, rpId: 'attaquant.fr' }),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('un défi d’un autre compte ne pose pas de clé sur le sien', async () => {
    const cookieCollab = await connexionParMotDePasse('collab@tarncompta.fr');
    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    // Le défi est ouvert par le collaborateur, présenté par l'administrateur.
    const { demande, defi } = await ouvrirEnregistrement(cookieCollab, '198.51.100.8');
    const intrus = new AuthentificateurFactice(33);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie: cookieAdmin, ...depuis('198.51.100.8') },
      payload: {
        demande,
        libelle: 'Détournée',
        reponse: intrus.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID }),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('un identifiant de justificatif déjà enregistré est refusé', async () => {
    // L'attestation n'étant pas demandée, l'identifiant vient du client : sans
    // contrainte d'unicité, un compte déclarerait celui d'un collègue avec sa propre clé.
    const cookieCollab = await connexionParMotDePasse('collab@tarncompta.fr');
    const { authentificateur, statut } = await enregistrerCle(cookieCollab, 40, 'Originale');
    expect(statut).toBe(200);

    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const { demande, defi } = await ouvrirEnregistrement(cookieAdmin, '198.51.100.9');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles',
      headers: { cookie: cookieAdmin, ...depuis('198.51.100.9') },
      payload: {
        demande,
        libelle: 'Usurpée',
        reponse: authentificateur.enregistrer({ defi, origine: ORIGINE, rpId: RP_ID }),
      },
    });
    expect(r.statusCode).toBe(409);
  });
});

describe('connexion par clé d’accès', () => {
  it('les options de connexion ne demandent aucune adresse et ne nomment aucune clé', async () => {
    // Composer la liste des clés d'une adresse ferait de ce point d'entrée public
    // l'oracle d'énumération que la connexion par mot de passe évite.
    const { corps, demande } = await ouvrirConnexion('203.0.113.20');
    expect(demande).toMatch(/^def_/);
    const options = (corps as { options: Record<string, unknown> }).options;
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe('required');
    expect(JSON.stringify(corps)).not.toContain('tarncompta.fr/');
  });

  it('une clé enregistrée ouvre une session, sans adresse ni mot de passe', async () => {
    const { authentificateur, email } = await compteAvecCle(50);

    const { demande, defi } = await ouvrirConnexion('203.0.113.21');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.21' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }),
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().utilisateur.email).toBe(email);

    // Le cookie posé est celui de l'interface, avec les mêmes attributs.
    const brut = r.headers['set-cookie'];
    const biscuit = Array.isArray(brut) ? brut[0] : (brut ?? '');
    expect(biscuit).toContain('HttpOnly');
    expect(biscuit).toContain('Secure');
    expect(biscuit).toContain('SameSite=Lax');

    // Et la session ouverte vaut vraiment.
    const moi = await app.inject({
      method: 'GET',
      url: '/api/auth/moi',
      headers: { cookie: biscuit.split(';')[0] },
    });
    expect(moi.json().utilisateur.email).toBe(email);
  });

  it('un défi de connexion ne sert qu’une fois', async () => {
    const { authentificateur } = await compteAvecCle(51);
    const { demande, defi } = await ouvrirConnexion('203.0.113.22');

    const un = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.22' },
      payload: { demande, reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(un.statusCode).toBe(200);

    const deux = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.22' },
      payload: { demande, reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(deux.statusCode).toBe(400);
  });

  it('un défi d’enregistrement ne vaut pas pour une connexion', async () => {
    const { authentificateur, cookie } = await compteAvecCle(52);
    const { demande, defi } = await ouvrirEnregistrement(cookie, '203.0.113.23');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.23' },
      payload: { demande, reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(r.statusCode).toBe(400);
  });

  it('une assertion signée pour une autre origine est refusée', async () => {
    // C'est la propriété qui justifie à elle seule les clés d'accès : une signature
    // obtenue sur le site d'un attaquant ne vaut rien ici.
    const { authentificateur } = await compteAvecCle(53);
    const { demande, defi } = await ouvrirConnexion('203.0.113.24');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.24' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({
          defi,
          origine: 'https://previs-tarncompta.attaquant.fr',
          rpId: RP_ID,
        }),
      },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur).toContain('n’a pas été reconnue');
  });

  it('une assertion produite pour un autre domaine est refusée', async () => {
    const { authentificateur } = await compteAvecCle(54);
    const { demande, defi } = await ouvrirConnexion('203.0.113.25');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.25' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: 'attaquant.fr' }),
      },
    });
    expect(r.statusCode).toBe(401);
  });

  it('une assertion sans vérification du porteur est refusée', async () => {
    // Une clé d'accès remplace le mot de passe : sans code ni biométrie, un appareil
    // ramassé ouvrirait le compte.
    const { authentificateur } = await compteAvecCle(55);
    const { demande, defi } = await ouvrirConnexion('203.0.113.26');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.26' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID, verifie: false }),
      },
    });
    expect(r.statusCode).toBe(401);
  });

  it('une signature produite par une autre clé est refusée', async () => {
    const { authentificateur } = await compteAvecCle(56);
    const autre = new AuthentificateurFactice(57);
    const { demande, defi } = await ouvrirConnexion('203.0.113.27');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.27' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({
          defi,
          origine: ORIGINE,
          rpId: RP_ID,
          signeAvec: autre,
        }),
      },
    });
    expect(r.statusCode).toBe(401);
  });

  it('un type de cérémonie faux est refusé', async () => {
    const { authentificateur } = await compteAvecCle(58);
    const { demande, defi } = await ouvrirConnexion('203.0.113.28');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.28' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({
          defi,
          origine: ORIGINE,
          rpId: RP_ID,
          type: 'webauthn.create',
        }),
      },
    });
    expect(r.statusCode).toBe(401);
  });

  it('un compteur qui régresse est refusé, et refusé proprement', async () => {
    // Un compteur qui n'avance plus alors qu'il avait avancé signale un authentificateur
    // dupliqué. La bibliothèque lève : sans filet, ce serait un 500 au lieu d'un refus.
    const { authentificateur } = await compteAvecCle(59);

    const premiere = await ouvrirConnexion('203.0.113.29');
    const un = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.29' },
      payload: {
        demande: premiere.demande,
        reponse: authentificateur.authentifier({
          defi: premiere.defi,
          origine: ORIGINE,
          rpId: RP_ID,
          compteur: 12,
        }),
      },
    });
    expect(un.statusCode).toBe(200);

    const seconde = await ouvrirConnexion('203.0.113.29');
    const deux = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.29' },
      payload: {
        demande: seconde.demande,
        reponse: authentificateur.authentifier({
          defi: seconde.defi,
          origine: ORIGINE,
          rpId: RP_ID,
          compteur: 5,
        }),
      },
    });
    expect(deux.statusCode).toBe(401);
    expect(deux.json().erreur).toContain('n’a pas été reconnue');
  });

  it('un compteur resté à zéro est accepté : c’est le cas des clés synchronisées', async () => {
    // Exiger une progression stricte casserait la majorité des clés d'accès —
    // trousseau iCloud, gestionnaire de mots de passe — qui rapportent zéro à vie.
    const { authentificateur } = await compteAvecCle(60);

    for (const adresse of ['203.0.113.30', '203.0.113.31']) {
      const { demande, defi } = await ouvrirConnexion(adresse);
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/cles/connexion',
        headers: { 'x-forwarded-for': adresse },
        payload: {
          demande,
          reponse: authentificateur.authentifier({ defi, origine: ORIGINE, rpId: RP_ID, compteur: 0 }),
        },
      });
      expect(r.statusCode, adresse).toBe(200);
    }
  });

  it('une clé inconnue est refusée du même message qu’une signature invalide', async () => {
    // Distinguer les deux dirait à qui essaie ce qu'il a touché.
    const inconnu = new AuthentificateurFactice(61);
    const { demande, defi } = await ouvrirConnexion('203.0.113.32');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.32' },
      payload: { demande, reponse: inconnu.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur).toBe('Cette clé d’accès n’a pas été reconnue.');
  });

  it('un porteur annoncé qui désigne un autre compte est refusé', async () => {
    const cible = await compteAvecCle(63);
    const autre = await compteAvecCle(64);
    const { demande, defi } = await ouvrirConnexion('203.0.113.40');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.40' },
      payload: {
        demande,
        reponse: cible.authentificateur.authentifier({
          defi,
          origine: ORIGINE,
          rpId: RP_ID,
          porteur: autre.id,
        }),
      },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().erreur).toBe('Cette clé d’accès n’a pas été reconnue.');
  });

  it('un porteur absent est refusé à la frontière', async () => {
    // Les clés sont enregistrées comme découvrables : la spécification veut qu'une telle
    // clé rapporte son porteur. Une réponse qui l'omet est mal formée, pas ambiguë.
    const { authentificateur } = await compteAvecCle(65);
    const { demande, defi } = await ouvrirConnexion('203.0.113.41');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.41' },
      payload: {
        demande,
        reponse: authentificateur.authentifier({
          defi,
          origine: ORIGINE,
          rpId: RP_ID,
          sansPorteur: true,
        }),
      },
    });
    expect(r.statusCode).toBe(422);
  });

  it('un corps de cérémonie démesuré ou mal formé est refusé avant tout décodage', async () => {
    // C'est le seul endroit du logiciel où des octets du client atteignent un décodeur
    // binaire : la borne est ce qui l'en protège.
    const { demande } = await ouvrirConnexion('203.0.113.42');
    for (const assertion of [
      undefined,
      42,
      null,
      { id: 'a', rawId: 'a', type: 'public-key', response: {} },
      {
        id: 'a',
        rawId: 'a',
        type: 'public-key',
        response: {
          clientDataJSON: 'A'.repeat(5000),
          authenticatorData: 'A',
          signature: 'A',
          userHandle: 'A',
        },
      },
      {
        id: 'ceci n’est pas du base64url',
        rawId: 'a',
        type: 'public-key',
        response: { clientDataJSON: 'A', authenticatorData: 'A', signature: 'A', userHandle: 'A' },
      },
    ]) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/cles/connexion',
        headers: { 'x-forwarded-for': '203.0.113.42' },
        payload: { demande, reponse: assertion },
      });
      expect(r.statusCode, JSON.stringify(assertion)?.slice(0, 60)).toBe(422);
    }
  });

  it('la clé d’un compte désactivé n’ouvre plus rien', async () => {
    const { authentificateur, id } = await compteAvecCle(62);

    // La clé fonctionne d'abord : sans cette moitié, l'essai passerait même si la clé
    // n'avait jamais valu.
    const avant = await ouvrirConnexion('203.0.113.33');
    const valide = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.33' },
      payload: {
        demande: avant.demande,
        reponse: authentificateur.authentifier({ defi: avant.defi, origine: ORIGINE, rpId: RP_ID }),
      },
    });
    expect(valide.statusCode).toBe(200);

    application.base.prepare('UPDATE utilisateurs SET actif = 0 WHERE id = ?').run(id);
    const apres = await ouvrirConnexion('203.0.113.34');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.34' },
      payload: {
        demande: apres.demande,
        reponse: authentificateur.authentifier({ defi: apres.defi, origine: ORIGINE, rpId: RP_ID }),
      },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('appartenance d’une clé', () => {
  it('la liste ne montre que ses propres clés', async () => {
    const cookieCollab = await connexionParMotDePasse('collab@tarncompta.fr');
    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    await enregistrerCle(cookieAdmin, 70, 'Clé de l’administrateur');

    const vueCollab = await app.inject({
      method: 'GET',
      url: '/api/auth/cles',
      headers: { cookie: cookieCollab },
    });
    const libelles = (vueCollab.json().cles as Array<{ libelle: string }>).map((c) => c.libelle);
    expect(libelles).not.toContain('Clé de l’administrateur');
  });

  it('un compte ne supprime pas la clé d’un autre', async () => {
    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const { corps } = await enregistrerCle(cookieAdmin, 71, 'À ne pas toucher');
    const idCle = (corps as unknown as { id: string }).id;

    const cookieCollab = await connexionParMotDePasse('collab@tarncompta.fr');
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/auth/cles/${idCle}`,
      headers: { cookie: cookieCollab, origin: ORIGINE },
    });
    expect(r.statusCode).toBe(404);

    // Elle est toujours là pour son porteur.
    const liste = await app.inject({
      method: 'GET',
      url: '/api/auth/cles',
      headers: { cookie: cookieAdmin },
    });
    expect((liste.json().cles as Array<{ id: string }>).some((c) => c.id === idCle)).toBe(true);
  });

  it('son porteur, lui, la retire — et se retrouve déconnecté', async () => {
    const cookie = await connexionParMotDePasse('admin@tarncompta.fr');
    const { corps } = await enregistrerCle(cookie, 72, 'Ancien téléphone');
    const idCle = (corps as unknown as { id: string }).id;

    const r = await app.inject({
      method: 'DELETE',
      url: `/api/auth/cles/${idCle}`,
      headers: { cookie, origin: ORIGINE },
    });
    expect(r.statusCode).toBe(200);

    // Le retrait ferme les sessions du compte : le cookie qui vient de servir est mort.
    // C'est le point de l'opération — l'appareil perdu ne doit pas garder son accès.
    const avecAncienCookie = await app.inject({
      method: 'GET',
      url: '/api/auth/cles',
      headers: { cookie },
    });
    expect(avecAncienCookie.statusCode).toBe(401);

    const neuf = await connexionParMotDePasse('admin@tarncompta.fr');
    const liste = await app.inject({ method: 'GET', url: '/api/auth/cles', headers: { cookie: neuf } });
    expect((liste.json().cles as Array<{ id: string }>).some((c) => c.id === idCle)).toBe(false);
  });

  it('la suppression d’un compte emporte ses clés', async () => {
    const jetable = await application.auth.creerUtilisateur({
      email: 'jetable@tarncompta.fr',
      nom: 'Jetable',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connexionParMotDePasse('jetable@tarncompta.fr');
    await enregistrerCle(cookie, 73);
    expect(application.cles.compter(jetable.id)).toBe(1);

    application.base.prepare('DELETE FROM utilisateurs WHERE id = ?').run(jetable.id);
    expect(application.cles.compter(jetable.id)).toBe(0);
  });
});

describe('changement de mot de passe', () => {
  it('il ferme les sessions et laisse les clés en place', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'change@tarncompta.fr',
      nom: 'Changeur',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connexionParMotDePasse('change@tarncompta.fr');
    await enregistrerCle(cookie, 80, 'Clé conservée');

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'un-nouveau-mot-de-passe-2026' },
    });
    expect(r.statusCode).toBe(200);

    // La session est fermée…
    const moi = await app.inject({ method: 'GET', url: '/api/auth/moi', headers: { cookie } });
    expect(moi.statusCode).toBe(401);
    // …mais la clé reste : l'effacer priverait le compte de son moyen le plus sûr au
    // moment même où il réagit à une alerte.
    expect(application.cles.compter(compte.id)).toBe(1);
  });

  it('il révoque les connecteurs autorisés du compte, quand c’est demandé', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'connecte@tarncompta.fr',
      nom: 'Connecté',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const client = application.oauth.enregistrerClient({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Claude',
    });
    const jetons = application.oauth.emettreJetons({
      clientId: client.client_id,
      utilisateurId: compte.id,
      ressource: `${ORIGINE}/mcp`,
    });
    expect(application.oauth.parJetonAcces(jetons.acces)?.email).toBe('connecte@tarncompta.fr');

    const cookie = await connexionParMotDePasse('connecte@tarncompta.fr');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'encore-un-autre-mot-de-passe-2026' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().connecteursRevoques).toBeGreaterThan(0);
    // Le connecteur gardait sinon trente jours d'accès aux dossiers.
    expect(application.oauth.parJetonAcces(jetons.acces)).toBeNull();
  });

  it('et les laisse en place quand on ne le demande pas', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'garde@tarncompta.fr',
      nom: 'Gardeur',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const client = application.oauth.enregistrerClient({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Claude',
    });
    const jetons = application.oauth.emettreJetons({
      clientId: client.client_id,
      utilisateurId: compte.id,
      ressource: `${ORIGINE}/mcp`,
    });

    const cookie = await connexionParMotDePasse('garde@tarncompta.fr');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: {
        ancien: MOT_DE_PASSE,
        nouveau: 'mot-de-passe-sans-revocation-2026',
        revoquerConnecteurs: false,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().connecteursRevoques).toBe(0);
    expect(application.oauth.parJetonAcces(jetons.acces)?.email).toBe('garde@tarncompta.fr');
  });
});

describe('ce qu’un administrateur peut faire des clés d’un autre', () => {
  it('il les voit et les retire, mais aucune route ne lui en fait poser une', async () => {
    const porteur = await compteAvecCle(90);
    const cles = application.cles.lister(porteur.id);
    expect(cles).toHaveLength(1);

    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const vue = await app.inject({
      method: 'GET',
      url: `/api/utilisateurs/${porteur.id}/cles`,
      headers: { cookie: cookieAdmin },
    });
    expect(vue.statusCode).toBe(200);
    expect(vue.json().cles).toHaveLength(1);
    // Ni clé publique, ni identifiant de justificatif : ce sont des valeurs stables et
    // corrélables, et le libellé suffit à reconnaître une clé.
    expect(JSON.stringify(vue.json())).not.toContain(porteur.authentificateur.identifiant);

    const retrait = await app.inject({
      method: 'DELETE',
      url: `/api/utilisateurs/${porteur.id}/cles/${cles[0].id}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
    });
    expect(retrait.statusCode).toBe(200);
    expect(application.cles.compter(porteur.id)).toBe(0);
  });

  it('un collaborateur ne voit pas les clés d’un autre compte par cette route', async () => {
    const porteur = await compteAvecCle(91);
    const cookie = await connexionParMotDePasse('collab@tarncompta.fr');
    const r = await app.inject({
      method: 'GET',
      url: `/api/utilisateurs/${porteur.id}/cles`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('changer son mot de passe : qui, et par quel chemin', () => {
  it('un compte en lecture seule change le sien', async () => {
    // « ecriture » le lui refusait : changer son propre mot de passe n'est pas une
    // écriture métier, et un lecteur doit pouvoir sécuriser son compte.
    await application.auth.creerUtilisateur({
      email: 'lecteur@tarncompta.fr',
      nom: 'Lecteur',
      motDePasse: MOT_DE_PASSE,
      role: 'lecteur',
    });
    const cookie = await connexionParMotDePasse('lecteur@tarncompta.fr');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'le-lecteur-a-change-2026' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('un jeton d’API ne change pas de mot de passe', async () => {
    // Il vit en clair dans un fichier de configuration : lui laisser changer le mot de
    // passe du compte qui l'a émis serait lui laisser s'approprier ce compte.
    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const jeton = (
      await app.inject({
        method: 'POST',
        url: '/api/jetons',
        headers: { cookie: cookieAdmin, origin: ORIGINE },
        payload: { libelle: 'Essai mot de passe', validiteJours: 1 },
      })
    ).json().jeton as string;

    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { [ENTETE_JETON]: jeton },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'change-par-un-jeton-2026' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('une écriture par cookie sur les routes de clés exige l’en-tête Origin', async () => {
    const porteur = await compteAvecCle(92);
    const cles = application.cles.lister(porteur.id);
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/auth/cles/${cles[0].id}`,
      headers: { cookie: porteur.cookie },
    });
    expect(r.statusCode).toBe(403);
    expect(application.cles.compter(porteur.id)).toBe(1);
  });
});

describe('ce que l’audit a relevé', () => {
  it('retirer une clé ferme les sessions du compte', async () => {
    // On retire une clé parce que l'appareil est perdu. Cet appareil garde pourtant sa
    // session ouverte trente jours : retirer la clé sans fermer les sessions ne fermerait
    // rien du tout.
    const porteur = await compteAvecCle(200);
    const avant = await app.inject({
      method: 'GET',
      url: '/api/auth/moi',
      headers: { cookie: porteur.cookie },
    });
    expect(avant.statusCode).toBe(200);

    const cles = application.cles.lister(porteur.id);
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/auth/cles/${cles[0].id}`,
      headers: { cookie: porteur.cookie, origin: ORIGINE },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().sessionsFermees).toBeGreaterThan(0);

    const apres = await app.inject({
      method: 'GET',
      url: '/api/auth/moi',
      headers: { cookie: porteur.cookie },
    });
    expect(apres.statusCode).toBe(401);
  });

  it('le plafond de clés est aussi contrôlé à l’écriture, non seulement à l’ouverture', async () => {
    // Rien n'empêche d'ouvrir dix cérémonies avant d'en achever aucune : le contrôle à
    // l'ouverture ne borne donc rien à lui seul.
    const compte = await application.auth.creerUtilisateur({
      email: 'plafond2@tarncompta.fr',
      nom: 'Plafond deux',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connexionParMotDePasse('plafond2@tarncompta.fr');

    // Onze cérémonies ouvertes d'affilée, alors qu'aucune clé n'existe encore.
    const ouvertes = [];
    for (let n = 0; n < 11; n += 1) {
      const o = await ouvrirEnregistrement(cookie, '198.51.100.30');
      expect(o.statut, `ouverture ${n}`).toBe(200);
      ouvertes.push(o);
    }

    let refusees = 0;
    for (let n = 0; n < ouvertes.length; n += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/cles',
        headers: { cookie, ...depuis('198.51.100.30') },
        payload: {
          demande: ouvertes[n].demande,
          libelle: `Clé ${n}`,
          reponse: new AuthentificateurFactice(300 + n).enregistrer({
            defi: ouvertes[n].defi,
            origine: ORIGINE,
            rpId: RP_ID,
          }),
        },
      });
      if (r.statusCode === 409) refusees += 1;
    }
    expect(refusees).toBeGreaterThan(0);
    expect(application.cles.compter(compte.id)).toBe(10);
  });

  it('un refus de connexion par clé laisse une trace au journal', async () => {
    const inconnu = new AuthentificateurFactice(210);
    const { demande, defi } = await ouvrirConnexion('203.0.113.60');
    await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.60' },
      payload: { demande, reponse: inconnu.authentifier({ defi, origine: ORIGINE, rpId: RP_ID }) },
    });
    const trace = application.base
      .prepare(
        "SELECT COUNT(*) AS n FROM journal_audit WHERE action = 'connexion_par_cle_refusee' AND detail = ?",
      )
      .get('203.0.113.60') as { n: number };
    expect(trace.n).toBeGreaterThan(0);
  });

  it('la révocation des connecteurs emporte aussi un code d’autorisation en attente', async () => {
    // Un code émis mais pas encore échangé vaut un couple de jetons neuf pour trente
    // jours : le laisser vivre laisserait l'accès rouvrir juste après la révocation.
    const compte = await application.auth.creerUtilisateur({
      email: 'code@tarncompta.fr',
      nom: 'Code en attente',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const client = application.oauth.enregistrerClient({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Claude',
    });
    const code = application.oauth.emettreCode({
      clientId: client.client_id,
      utilisateurId: compte.id,
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: 'A'.repeat(43),
      ressource: `${ORIGINE}/mcp`,
    });

    const cookie = await connexionParMotDePasse('code@tarncompta.fr');
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/motdepasse',
      headers: { cookie, origin: ORIGINE },
      payload: { ancien: MOT_DE_PASSE, nouveau: 'un-mot-de-passe-tout-neuf-2026' },
    });
    expect(r.statusCode).toBe(200);

    const restant = application.base
      .prepare('SELECT consomme_le FROM oauth_codes WHERE empreinte IS NOT NULL AND utilisateur_id = ?')
      .get(compte.id) as { consomme_le: string | null };
    expect(restant.consomme_le).not.toBeNull();
    expect(code).toMatch(/^previs_ac_/);
  });

  it('la réinitialisation par un administrateur révoque aussi les connecteurs', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'reinit@tarncompta.fr',
      nom: 'Réinitialisé',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const client = application.oauth.enregistrerClient({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Claude',
    });
    const jetons = application.oauth.emettreJetons({
      clientId: client.client_id,
      utilisateurId: compte.id,
      ressource: `${ORIGINE}/mcp`,
    });
    expect(application.oauth.parJetonAcces(jetons.acces)?.email).toBe('reinit@tarncompta.fr');

    const cookieAdmin = await connexionParMotDePasse('admin@tarncompta.fr');
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/utilisateurs/${compte.id}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { motDePasse: 'mot-de-passe-remis-par-admin-2026' },
    });
    expect(r.statusCode).toBe(200);
    expect(application.oauth.parJetonAcces(jetons.acces)).toBeNull();
  });

  it('une adresse publique numérique désactive les clés, avec le bon motif', async () => {
    // Un identifiant de partie de confiance est un nom de domaine : le navigateur
    // refuserait une adresse numérique, et le message serait incompréhensible.
    const p = partieDeConfiance('https://203.0.113.10');
    expect(p.actives).toBe(false);
    expect(p.motif).toContain('nom de domaine');
    // La boucle locale, elle, reste acceptée.
    expect(partieDeConfiance('http://127.0.0.1:8080').actives).toBe(true);
  });

  it('le serveur distingue un identifiant refusé d’une session expirée', async () => {
    // Les deux répondent 401, et l'interface doit les traiter autrement : afficher le
    // message là où l'on vient de saisir, ou renvoyer à l'écran de connexion.
    const refus = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      headers: { 'x-forwarded-for': '198.51.100.40' },
      payload: { email: 'admin@tarncompta.fr', motDePasse: 'ce-n-est-pas-le-bon' },
    });
    expect(refus.statusCode).toBe(401);
    expect(refus.json().code).toBe('identifiant_refuse');

    const sansSession = await app.inject({ method: 'GET', url: '/api/auth/moi' });
    expect(sansSession.statusCode).toBe(401);
    expect(sansSession.json().code).toBe('non_authentifie');

    const cleRefusee = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion',
      headers: { 'x-forwarded-for': '203.0.113.61' },
      payload: {
        demande: (await ouvrirConnexion('203.0.113.61')).demande,
        reponse: new AuthentificateurFactice(220).authentifier({
          defi: 'A'.repeat(43),
          origine: ORIGINE,
          rpId: RP_ID,
        }),
      },
    });
    expect(cleRefusee.statusCode).toBe(401);
    expect(cleRefusee.json().code).toBe('identifiant_refuse');
  });

  it('l’ouverture d’une cérémonie d’enregistrement est plafonnée par compte', async () => {
    // Chaque ouverture coûte une vérification scrypt : le compteur d'échecs ne borne rien
    // tant que le mot de passe présenté est juste.
    await application.auth.creerUtilisateur({
      email: 'debit@tarncompta.fr',
      nom: 'Débit',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connexionParMotDePasse('debit@tarncompta.fr');
    let dernier = 0;
    for (let n = 0; n < 31; n += 1) {
      const r = await ouvrirEnregistrement(cookie, '198.51.100.41');
      dernier = r.statut;
      if (dernier === 429) break;
    }
    expect(dernier).toBe(429);
  });
});

describe('plafonds', () => {
  it('le nombre de clés par compte est plafonné', async () => {
    const compte = await application.auth.creerUtilisateur({
      email: 'plafond@tarncompta.fr',
      nom: 'Plafond',
      motDePasse: MOT_DE_PASSE,
      role: 'collaborateur',
    });
    const cookie = await connexionParMotDePasse('plafond@tarncompta.fr');
    for (let n = 0; n < 10; n += 1) {
      const { statut } = await enregistrerCle(cookie, 100 + n, `Clé ${n}`);
      expect(statut, `clé ${n}`).toBe(200);
    }
    expect(application.cles.compter(compte.id)).toBe(10);

    const r = await ouvrirEnregistrement(cookie, '198.51.100.20');
    expect(r.statut).toBe(409);
  });

  it('l’émission d’un défi de connexion est plafonnée par adresse', async () => {
    let dernier = 0;
    for (let n = 0; n < 31; n += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/cles/connexion/options',
        headers: { 'x-forwarded-for': '203.0.113.99' },
      });
      dernier = r.statusCode;
      if (dernier === 429) break;
    }
    expect(dernier).toBe(429);

    // Une autre adresse n'est pas pénalisée.
    const autre = await app.inject({
      method: 'POST',
      url: '/api/auth/cles/connexion/options',
      headers: { 'x-forwarded-for': '203.0.113.98' },
    });
    expect(autre.statusCode).toBe(200);
  });
});

describe('déploiement en clair', () => {
  it('les clés d’accès sont refusées, avec un motif qui dit quoi corriger', async () => {
    const enClair = await construireApplication({
      ...config,
      urlPublique: 'http://previs.tarncompta.fr',
      cookiesSecurises: false,
    });
    try {
      expect(enClair.cles.actives).toBe(false);
      const r = await enClair.app.inject({
        method: 'POST',
        url: '/api/auth/cles/connexion/options',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json().erreur).toContain('PUBLIC_URL');
    } finally {
      await enClair.app.close();
    }
  });
});

describe('rien de tout cela ne dérange le reste', () => {
  it('la connexion par mot de passe fonctionne toujours', async () => {
    const cookie = await connexionParMotDePasse('admin@tarncompta.fr');
    expect(cookie).toContain('previs_session=');
    const moi = await app.inject({ method: 'GET', url: '/api/auth/moi', headers: { cookie } });
    expect(moi.json().utilisateur.email).toBe('admin@tarncompta.fr');
    expect(moi.json().utilisateur.role).toBe('admin');
    expect(idAdmin).not.toBe('');
  });
});

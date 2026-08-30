import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ENTETE_JETON, LOGO_MAX_CARACTERES } from '@previs/core';
import { construireApplication, type Application } from '../src/index.js';
import type { Configuration } from '../src/config.js';
import { verifierLogo } from '../src/cabinet.js';

/**
 * Identité du cabinet et logos.
 *
 * Deux exigences se croisent ici : rien de l'identité du cabinet ne doit rester écrit
 * dans le code, et aucun fichier arbitraire ne doit pouvoir se faire passer pour une
 * image — le PDF comme l'interface le serviraient ensuite au navigateur.
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

/** Le plus petit PNG valide : huit octets de signature suffisent au contrôle. */
const PNG = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]).toString('base64')}`;

const MOT_DE_PASSE = 'motdepasse-de-test-2026';
let application: Application;
let app: FastifyInstance;
let cookieAdmin = '';
let cookieCollaborateur = '';
let jeton = '';
let dossierId = '';

beforeAll(async () => {
  application = await construireApplication(config);
  app = application.app;

  await application.auth.creerUtilisateur({
    email: 'admin@tarncompta.fr', nom: 'Admin', motDePasse: MOT_DE_PASSE, role: 'admin',
  });
  await application.auth.creerUtilisateur({
    email: 'collab@tarncompta.fr', nom: 'Collaborateur', motDePasse: MOT_DE_PASSE, role: 'collaborateur',
  });

  const connecter = async (email: string) => {
    const r = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email, motDePasse: MOT_DE_PASSE },
    });
    const brut = r.headers['set-cookie'];
    return (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
  };
  cookieAdmin = await connecter('admin@tarncompta.fr');
  cookieCollaborateur = await connecter('collab@tarncompta.fr');

  const j = await app.inject({
    method: 'POST', url: '/api/jetons',
    headers: { cookie: cookieAdmin, origin: ORIGINE },
    payload: { libelle: 'Essai', validiteJours: 1 },
  });
  jeton = j.json().jeton as string;

  const d = await app.inject({
    method: 'POST', url: '/api/dossiers',
    headers: { cookie: cookieAdmin, origin: ORIGINE },
    payload: { nom: 'Client d’essai', modele: 'IS' },
  });
  dossierId = d.json().id as string;
});

afterAll(async () => {
  await app.close();
});

describe('identité du cabinet', () => {
  it('elle existe dès le premier démarrage, sans être figée dans le code', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/cabinet', headers: { cookie: cookieAdmin } });
    expect(r.statusCode).toBe(200);
    expect(r.json().nom).toBe('TARN COMPTA');
    expect(r.json()).toHaveProperty('siret');
    expect(r.json()).toHaveProperty('inscriptionOrdre');
  });

  it('tout compte la lit, seul un administrateur la modifie', async () => {
    const lecture = await app.inject({
      method: 'GET', url: '/api/cabinet', headers: { cookie: cookieCollaborateur },
    });
    expect(lecture.statusCode).toBe(200);

    const ecriture = await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { cookie: cookieCollaborateur, origin: ORIGINE },
      payload: { nom: 'Cabinet pirate' },
    });
    expect(ecriture.statusCode).toBe(403);
  });

  it('un jeton d’API ne modifie pas l’identité du cabinet', async () => {
    const r = await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { [ENTETE_JETON]: jeton },
      payload: { nom: 'Cabinet pirate' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('une modification partielle préserve les champs non fournis', async () => {
    await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { siret: '12345678900012', inscriptionOrdre: 'Tableau de l’Ordre — Occitanie' },
    });
    const r = await app.inject({ method: 'GET', url: '/api/cabinet', headers: { cookie: cookieAdmin } });
    expect(r.json().siret).toBe('12345678900012');
    expect(r.json().inscriptionOrdre).toBe('Tableau de l’Ordre — Occitanie');
    // Le téléphone n'était pas dans la requête : il ne doit pas avoir été effacé.
    expect(r.json().telephone).toBe('05.31.51.15.51');
  });

  it('le logo du cabinet est accepté puis relu', async () => {
    const pose = await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: PNG },
    });
    expect(pose.statusCode).toBe(200);
    expect(pose.json().logo).toBe(PNG);

    const retrait = await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: '' },
    });
    expect(retrait.json().logo).toBe('');
  });
});

describe('logo d’un dossier client', () => {
  it('il est déposé, relu et retiré', async () => {
    const pose = await app.inject({
      method: 'PUT', url: `/api/dossiers/${dossierId}/logo`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: PNG },
    });
    expect(pose.statusCode).toBe(200);
    expect(pose.json().logo).toBe(PNG);

    const relu = await app.inject({
      method: 'GET', url: `/api/dossiers/${dossierId}`, headers: { cookie: cookieAdmin },
    });
    expect(relu.json().logo).toBe(PNG);
  });

  it('il survit à une écriture du dossier — il n’est pas dans le contenu versionné', async () => {
    const avant = await app.inject({
      method: 'GET', url: `/api/dossiers/${dossierId}`, headers: { cookie: cookieAdmin },
    });
    const enregistre = avant.json();

    const ecriture = await app.inject({
      method: 'PUT', url: `/api/dossiers/${dossierId}`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { dossier: enregistre.dossier, versionAttendue: enregistre.version },
    });
    expect(ecriture.statusCode).toBe(200);
    expect(ecriture.json().logo).toBe(PNG);
  });

  it('la duplication d’un dossier reprend son logo', async () => {
    const copie = await app.inject({
      method: 'POST', url: `/api/dossiers/${dossierId}/dupliquer`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
    });
    expect(copie.statusCode).toBe(200);
    expect(copie.json().logo).toBe(PNG);
  });

  it('un compte en lecture seule ne dépose pas de logo', async () => {
    await application.auth.creerUtilisateur({
      email: 'lecteur@tarncompta.fr', nom: 'Lecteur', motDePasse: MOT_DE_PASSE, role: 'lecteur',
    });
    const r0 = await app.inject({
      method: 'POST', url: '/api/auth/connexion',
      payload: { email: 'lecteur@tarncompta.fr', motDePasse: MOT_DE_PASSE },
    });
    const brut = r0.headers['set-cookie'];
    const cookie = (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];

    const r = await app.inject({
      method: 'PUT', url: `/api/dossiers/${dossierId}/logo`,
      headers: { cookie, origin: ORIGINE },
      payload: { logo: PNG },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe('contrôle du contenu des images', () => {
  it('un fichier qui se prétend PNG sans en être un est refusé', async () => {
    const faux = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    expect(verifierLogo(faux)).toEqual({ ok: false, raison: expect.any(String) });

    const r = await app.inject({
      method: 'PUT', url: `/api/dossiers/${dossierId}/logo`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: faux },
    });
    expect(r.statusCode).toBe(422);
  });

  it('le SVG est refusé — c’est un document, pas une image inerte', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    const r = await app.inject({
      method: 'PUT', url: '/api/cabinet',
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: svg },
    });
    expect(r.statusCode).toBe(422);
  });

  it('un logo au-delà du plafond est refusé', async () => {
    const enorme = `data:image/png;base64,${'A'.repeat(LOGO_MAX_CARACTERES)}`;
    const r = await app.inject({
      method: 'PUT', url: `/api/dossiers/${dossierId}/logo`,
      headers: { cookie: cookieAdmin, origin: ORIGINE },
      payload: { logo: enorme },
    });
    expect(r.statusCode).toBe(422);
  });

  it('un conteneur RIFF qui n’est pas un WebP est refusé', async () => {
    const riff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]);
    const faux = `data:image/webp;base64,${riff.toString('base64')}`;
    expect(verifierLogo(faux).ok).toBe(false);
  });

  it('un vrai PNG passe, et l’absence de logo aussi', () => {
    expect(verifierLogo(PNG)).toEqual({ ok: true });
    expect(verifierLogo('')).toEqual({ ok: true });
  });
});

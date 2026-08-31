import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ENTETE_JETON, PORTEE_DOSSIERS } from '@previs/core';
import { construireApplication, type Application } from '../src/index.js';
import type { Configuration } from '../src/config.js';

/**
 * Autorisation OAuth 2.1 du point d'entrée MCP.
 *
 * Chaque essai verrouille une exigence de la spécification ou une protection dont
 * l'absence rendrait le flux exploitable. Un échec ici ne signale pas un chiffre qui a
 * bougé mais une porte ouverte.
 */
const ORIGINE = 'https://previs.tarncompta.fr';
const REDIRECTION = 'https://claude.ai/api/mcp/auth_callback';
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
let clientId = '';

/** Couple PKCE : un vérificateur aléatoire et son empreinte en S256. */
function pkce(): { verificateur: string; defi: string } {
  const verificateur = randomBytes(48).toString('base64url');
  return { verificateur, defi: createHash('sha256').update(verificateur).digest('base64url') };
}

function parametresDe(url: string): URLSearchParams {
  return new URL(url, ORIGINE).searchParams;
}

/** Déroule le flux jusqu'au code d'autorisation. */
async function obtenirCode(options: {
  defi: string;
  redirection?: string;
  courriel?: string;
  motDePasse?: string;
} ): Promise<{ statut: number; localisation: string; corps: string }> {
  const redirection = options.redirection ?? REDIRECTION;
  const page = await app.inject({
    method: 'GET',
    url: '/oauth/autoriser',
    query: {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirection,
      code_challenge: options.defi,
      code_challenge_method: 'S256',
      state: 'etat-du-client',
      scope: PORTEE_DOSSIERS,
    },
  });
  const demande = /name="demande" value="([^"]+)"/.exec(page.body)?.[1] ?? '';

  const soumission = await app.inject({
    method: 'POST',
    url: '/oauth/autoriser',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGINE },
    payload: new URLSearchParams({
      demande,
      decision: 'accepter',
      courriel: options.courriel ?? 'collab@tarncompta.fr',
      motdepasse: options.motDePasse ?? MOT_DE_PASSE,
    }).toString(),
  });
  return {
    statut: soumission.statusCode,
    localisation: String(soumission.headers.location ?? ''),
    corps: soumission.body,
  };
}

async function echangerCode(entree: {
  code: string;
  verificateur: string;
  redirection?: string;
  client?: string;
}) {
  return app.inject({
    method: 'POST',
    url: '/oauth/jeton',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code: entree.code,
      redirect_uri: entree.redirection ?? REDIRECTION,
      client_id: entree.client ?? clientId,
      code_verifier: entree.verificateur,
    }).toString(),
  });
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
  await application.auth.creerUtilisateur({
    email: 'admin@tarncompta.fr',
    nom: 'Admin',
    motDePasse: MOT_DE_PASSE,
    role: 'admin',
  });

  const enregistrement = await app.inject({
    method: 'POST',
    url: '/oauth/enregistrer',
    payload: { redirect_uris: [REDIRECTION], client_name: 'Claude' },
  });
  clientId = enregistrement.json().client_id as string;
});

afterAll(async () => {
  await app.close();
});

describe('découverte', () => {
  it('les métadonnées de la ressource désignent le serveur d’autorisation', async () => {
    for (const chemin of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const r = await app.inject({ method: 'GET', url: chemin });
      expect(r.statusCode, chemin).toBe(200);
      expect(r.json().resource).toBe(`${ORIGINE}/mcp`);
      expect(r.json().authorization_servers).toEqual([ORIGINE]);
    }
  });

  it('les métadonnées du serveur d’autorisation n’annoncent que ce qui est réellement servi', async () => {
    const r = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    const m = r.json();
    expect(m.issuer).toBe(ORIGINE);
    expect(m.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(m.response_types_supported).toEqual(['code']);
    // « plain » ne protège de rien : il ne doit pas être annoncé, donc jamais proposé.
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.registration_endpoint).toBe(`${ORIGINE}/oauth/enregistrer`);
  });
});

describe('enregistrement d’un client', () => {
  it('un client est enregistré sans secret — PKCE tient ce rôle', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: ['https://exemple.fr/retour'], client_name: 'Essai' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().client_id).toMatch(/^cli_/);
    expect(r.json().token_endpoint_auth_method).toBe('none');
    expect(r.json()).not.toHaveProperty('client_secret');
  });

  it('une redirection en clair hors boucle locale est refusée', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: ['http://exemple.fr/retour'] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_redirect_uri');
  });

  it('la boucle locale en clair est acceptée — un client de bureau y écoute', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: ['http://127.0.0.1:47821/retour', 'http://localhost:3000/cb'] },
    });
    expect(r.statusCode).toBe(201);
  });

  it('une redirection portant un fragment est refusée', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: ['https://exemple.fr/retour#fragment'] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('un enregistrement sans adresse de redirection est refusé', async () => {
    const r = await app.inject({ method: 'POST', url: '/oauth/enregistrer', payload: { client_name: 'X' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_client_metadata');
  });
});

describe('autorisation', () => {
  it('une adresse de redirection non enregistrée ne provoque AUCUNE redirection', async () => {
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'https://site-malveillant.example/vol',
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    // Rediriger vers une adresse non vérifiée serait une redirection ouverte, et le
    // message d'erreur partirait chez l'attaquant.
    expect(r.statusCode).toBe(400);
    expect(r.headers.location).toBeUndefined();
    expect(r.json().error).toBe('invalid_request');
  });

  it('un client inconnu est refusé sans redirection', async () => {
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: 'cli_inexistant',
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.headers.location).toBeUndefined();
  });

  it('PKCE en méthode « plain » est refusé', async () => {
    const { verificateur } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: verificateur,
        code_challenge_method: 'plain',
        state: 'abc',
      },
    });
    expect(r.statusCode).toBe(302);
    expect(parametresDe(String(r.headers.location)).get('error')).toBe('invalid_request');
    expect(parametresDe(String(r.headers.location)).get('state')).toBe('abc');
  });

  it('PKCE absent est refusé', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
      },
    });
    expect(r.statusCode).toBe(302);
    expect(parametresDe(String(r.headers.location)).get('error')).toBe('invalid_request');
  });

  it('un jeton destiné à une autre ressource est refusé', async () => {
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
        resource: 'https://un-autre-serveur.example/mcp',
      },
    });
    expect(parametresDe(String(r.headers.location)).get('error')).toBe('invalid_target');
  });

  it('l’écran de consentement nomme le client et n’expose aucun script', async () => {
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Claude');
    expect(r.body).toContain('name="demande"');
    expect(r.body).not.toMatch(/<script/i);
    // Les paramètres ne sont pas recopiés dans le formulaire : qui le soumet ne peut
    // donc pas changer l'adresse de redirection en cours de route.
    expect(r.body).not.toContain(REDIRECTION);
  });
});

describe('plafonds sur ce qui s’écrit sans authentification', () => {
  // L'enregistrement d'un client et l'ouverture d'une demande sont les deux seules
  // écritures que personne n'a eu à s'authentifier pour obtenir : sans plafond, une
  // boucle les répéterait jusqu'à remplir le disque.
  it('l’enregistrement d’un client est plafonné par adresse', async () => {
    const depuis = { 'x-forwarded-for': '203.0.113.7' };
    let dernier = 0;
    for (let n = 0; n < 31; n += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/oauth/enregistrer',
        headers: depuis,
        payload: { redirect_uris: ['https://exemple.fr/retour'] },
      });
      dernier = r.statusCode;
      if (dernier === 429) break;
    }
    expect(dernier).toBe(429);

    // Une autre adresse n'est pas pénalisée.
    const autre = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      headers: { 'x-forwarded-for': '203.0.113.8' },
      payload: { redirect_uris: ['https://exemple.fr/retour'] },
    });
    expect(autre.statusCode).toBe(201);
  });

  it('l’ouverture d’une demande d’autorisation est plafonnée par adresse', async () => {
    const { defi } = pkce();
    const query = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECTION,
      code_challenge: defi,
      code_challenge_method: 'S256',
      state: 'etat-du-client',
    };
    let redirige = false;
    for (let n = 0; n < 31; n += 1) {
      const r = await app.inject({
        method: 'GET',
        url: '/oauth/autoriser',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        query,
      });
      if (r.statusCode === 302) {
        expect(parametresDe(String(r.headers.location)).get('error')).toBe('temporarily_unavailable');
        redirige = true;
        break;
      }
    }
    expect(redirige).toBe(true);
  });
});

describe('révocation depuis l’écran Administration', () => {
  async function cookieAdmin(): Promise<string> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: 'admin@tarncompta.fr', motDePasse: MOT_DE_PASSE },
    });
    const brut = r.headers['set-cookie'];
    return (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
  }

  it('l’autorisation accordée apparaît, et sa révocation coupe l’accès', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const jeton = (await echangerCode({ code, verificateur })).json().access_token as string;
    const cookie = await cookieAdmin();

    const liste = await app.inject({
      method: 'GET',
      url: '/api/oauth/autorisations',
      headers: { cookie },
    });
    expect(liste.statusCode).toBe(200);
    const accordee = (liste.json() as Array<Record<string, string>>).find(
      (a) => a.courriel === 'collab@tarncompta.fr' && a.clientId === clientId,
    );
    expect(accordee?.nomClient).toBe('Claude');

    const r = await app.inject({
      method: 'DELETE',
      url: `/api/oauth/autorisations/${accordee!.utilisateurId}/${clientId}`,
      headers: { cookie, origin: ORIGINE },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().revoques).toBeGreaterThan(0);
    // Ce que promet l'écran de consentement : l'accès cesse immédiatement.
    expect(application.oauth.parJetonAcces(jeton)).toBeNull();
  });

  /*
   * Le trou que l'audit a relevé : entre le consentement et l'échange du code, aucun jeton
   * n'existe. La liste ne montrait donc RIEN, et la révocation n'atteignait pas le code.
   * L'expert-comptable qui vient d'approuver un connecteur par erreur ouvre cet écran, et
   * c'est exactement l'instant où il doit y trouver quelque chose à révoquer.
   */
  it('un consentement dont le jeton n’est pas encore retiré apparaît déjà', async () => {
    const { defi } = pkce();
    await obtenirCode({ defi });
    const cookie = await cookieAdmin();

    const liste = (
      await app.inject({ method: 'GET', url: '/api/oauth/autorisations', headers: { cookie } })
    ).json() as Array<Record<string, unknown>>;
    const attente = liste.find((a) => a.clientId === clientId && a.enAttente === true);
    expect(attente, 'le consentement en attente doit être listé').toBeTruthy();
    expect(attente!.courriel).toBe('collab@tarncompta.fr');
    expect(attente!.nomClient).toBe('Claude');
  });

  it('et sa révocation empêche l’échange du code', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const cookie = await cookieAdmin();

    const liste = (
      await app.inject({ method: 'GET', url: '/api/oauth/autorisations', headers: { cookie } })
    ).json() as Array<Record<string, string>>;
    const attente = liste.find((a) => a.clientId === clientId)!;

    const revocation = await app.inject({
      method: 'DELETE',
      url: `/api/oauth/autorisations/${attente.utilisateurId}/${clientId}`,
      headers: { cookie, origin: ORIGINE },
    });
    expect(revocation.statusCode).toBe(200);

    // La conséquence d'abord, le décompte ensuite : sans le comptage des codes, cet
    // échange rendait un couple de jetons neuf pour trente jours, dans les dix minutes
    // qui suivaient la révocation.
    const echange = await echangerCode({ code, verificateur });
    expect(echange.statusCode).toBe(400);
    expect(echange.json().error).toBe('invalid_grant');
    expect(revocation.json().revoques).toBeGreaterThan(0);
  });

  it('la liste des autorisations est réservée aux administrateurs', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/oauth/autorisations' });
    expect(r.statusCode).toBe(401);

    const connexion = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: 'collab@tarncompta.fr', motDePasse: MOT_DE_PASSE },
    });
    const brut = connexion.headers['set-cookie'];
    const cookie = (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
    const collaborateur = await app.inject({
      method: 'GET',
      url: '/api/oauth/autorisations',
      headers: { cookie },
    });
    expect(collaborateur.statusCode).toBe(403);
  });
});

describe('identité du cabinet sur l’écran de consentement', () => {
  it('le nom et le logo viennent de l’écran Administration, non du code', async () => {
    const logo =
      'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    application.cabinet.enregistrer({ nom: 'CABINET D’ESSAI', logo });

    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    expect(r.body).toContain('CABINET D’ESSAI');
    expect(r.body).toContain(logo);
    expect(r.body).not.toContain('TARN COMPTA');

    application.cabinet.enregistrer({ nom: 'TARN COMPTA', logo: '' });
  });
});

describe('l’écran de consentement dit où part l’autorisation', () => {
  /*
   * L'enchaînement que ces essais interdisent, vérifié une fois contre le serveur avant
   * correction : l'enregistrement dynamique étant ouvert par nécessité — un connecteur MCP
   * s'enregistre lui-même, sans authentification — un inconnu enregistrait un client en
   * choisissant son NOM et son ADRESSE DE RETOUR, puis envoyait au comptable un lien vers
   * l'écran de consentement. Celui-ci s'affichait sur le domaine du cabinet, avec le logo du
   * cabinet, réclamait l'adresse et le mot de passe, présentait le nom choisi par l'inconnu —
   * « Previs — vérification de sécurité obligatoire » — et ne nommait nulle part la
   * destination. Le code d'autorisation partait chez l'inconnu, qui l'échangeait contre un
   * jeton de lecture et d'écriture sur tous les dossiers.
   */
  it('l’origine de l’adresse de retour est nommée dans la page', async () => {
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('L’autorisation sera envoyée à');
    expect(r.body).toContain(new URL(REDIRECTION).origin);
  });

  it('un connecteur jamais autorisé porte un avertissement', async () => {
    const enr = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: {
        client_name: 'Previs — vérification de sécurité obligatoire',
        redirect_uris: ['https://attaquant.example/collecte'],
      },
    });
    expect(enr.statusCode).toBe(201);
    const inconnu = enr.json().client_id as string;

    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: inconnu,
        redirect_uri: 'https://attaquant.example/collecte',
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    expect(r.statusCode).toBe(200);
    // La destination est nommée, et le nom choisi par l'inconnu est présenté comme tel.
    expect(r.body).toContain('https://attaquant.example');
    expect(r.body).toContain('jamais été autorisé');
    expect(r.body).toContain('choisi par celui qui demande l’accès');
  });

  it('une adresse de retour démesurée est refusée à l’enregistrement', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: [`https://attaquant.example/${'a'.repeat(500)}`] },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('politique de contenu de l’écran de consentement', () => {
  it('la soumission du formulaire vers l’adresse de retour du client est autorisée', async () => {
    // WebKit applique `form-action` à la redirection qui suit la soumission : avec
    // « 'self' » seul, le retour vers le connecteur serait bloqué et le flux
    // n'aboutirait jamais.
    const { defi } = pkce();
    const r = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
      },
    });
    const politique = String(r.headers['content-security-policy']);
    expect(politique).toContain("form-action 'self' https://claude.ai");
    expect(politique).toContain("default-src 'none'");
    expect(politique).toContain("frame-ancestors 'none'");
  });
});

describe('consentement', () => {
  it('un refus renvoie access_denied, avec l’état du client', async () => {
    const { defi } = pkce();
    const page = await app.inject({
      method: 'GET',
      url: '/oauth/autoriser',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECTION,
        code_challenge: defi,
        code_challenge_method: 'S256',
        state: 'etat-du-client',
      },
    });
    const demande = /name="demande" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/autoriser',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGINE },
      payload: new URLSearchParams({ demande, decision: 'refuser' }).toString(),
    });
    expect(r.statusCode).toBe(302);
    expect(parametresDe(String(r.headers.location)).get('error')).toBe('access_denied');
    expect(parametresDe(String(r.headers.location)).get('state')).toBe('etat-du-client');
  });

  it('un mot de passe faux ne délivre pas de code', async () => {
    const { defi } = pkce();
    const r = await obtenirCode({ defi, motDePasse: 'mauvais-mot-de-passe' });
    expect(r.statut).toBe(401);
    expect(r.localisation).toBe('');
    expect(r.corps).toContain('incorrect');
  });

  it('une demande expirée ou inventée est refusée', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/autoriser',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGINE },
      payload: new URLSearchParams({
        demande: 'dem_inexistante',
        decision: 'accepter',
        courriel: 'collab@tarncompta.fr',
        motdepasse: MOT_DE_PASSE,
      }).toString(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.headers.location).toBeUndefined();
  });

  it('un consentement accordé renvoie un code, et l’état du client', async () => {
    const { defi } = pkce();
    const r = await obtenirCode({ defi });
    expect(r.statut).toBe(302);
    const p = parametresDe(r.localisation);
    expect(p.get('code')).toMatch(/^previs_ac_/);
    expect(p.get('state')).toBe('etat-du-client');
    expect(r.localisation.startsWith(REDIRECTION)).toBe(true);
  });
});

describe('échange du code', () => {
  it('le flux complet délivre un jeton d’accès et un jeton de rafraîchissement', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const r = await echangerCode({ code, verificateur });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.access_token).toMatch(/^previs_at_/);
    expect(j.refresh_token).toMatch(/^previs_rt_/);
    expect(j.token_type).toBe('Bearer');
    expect(j.expires_in).toBe(3600);
    expect(j.scope).toBe(PORTEE_DOSSIERS);
    // Une réponse d'autorisation ne doit jamais être servie depuis un cache.
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('un vérificateur PKCE faux ne délivre rien', async () => {
    const { defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const r = await echangerCode({ code, verificateur: pkce().verificateur });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_grant');
  });

  it('un code présenté par un autre client est refusé', async () => {
    const autre = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: [REDIRECTION], client_name: 'Autre' },
    });
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const r = await echangerCode({ code, verificateur, client: autre.json().client_id });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_grant');
  });

  it('un code présenté avec une autre adresse de redirection est refusé', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const r = await echangerCode({ code, verificateur, redirection: 'https://exemple.fr/retour' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_grant');
  });

  it('un code rejoué est refusé, et révoque ce qui avait été émis', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const premier = await echangerCode({ code, verificateur });
    const jetonAcces = premier.json().access_token as string;

    const second = await echangerCode({ code, verificateur });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('invalid_grant');

    // Un code rejoué signale une interception : le jeton déjà émis ne vaut plus rien.
    expect(application.oauth.parJetonAcces(jetonAcces)).toBeNull();
  });

  it('un code inventé est refusé', async () => {
    const r = await echangerCode({ code: 'previs_ac_inexistant', verificateur: pkce().verificateur });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_grant');
  });

  it('un type d’autorisation inconnu est refusé', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/jeton',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'password', username: 'x', password: 'y' }).toString(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('unsupported_grant_type');
  });
});

describe('rafraîchissement', () => {
  async function couple() {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    return (await echangerCode({ code, verificateur })).json();
  }

  const rafraichir = (jeton: string, client = clientId) =>
    app.inject({
      method: 'POST',
      url: '/oauth/jeton',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: jeton,
        client_id: client,
      }).toString(),
    });

  it('un rafraîchissement délivre un couple neuf, et fait tourner le jeton', async () => {
    const initial = await couple();
    const r = await rafraichir(initial.refresh_token);
    expect(r.statusCode).toBe(200);
    expect(r.json().access_token).not.toBe(initial.access_token);
    expect(r.json().refresh_token).not.toBe(initial.refresh_token);
  });

  it('l’ancien jeton de rafraîchissement ne vaut plus rien, et son rejeu révoque la lignée', async () => {
    const initial = await couple();
    const renouvele = (await rafraichir(initial.refresh_token)).json();

    const rejeu = await rafraichir(initial.refresh_token);
    expect(rejeu.statusCode).toBe(400);
    expect(rejeu.json().error).toBe('invalid_grant');

    // Le rejeu d'un jeton déjà échangé est le seul signe d'une fuite : toute la lignée
    // tombe, y compris le jeton d'accès légitimement obtenu entre-temps.
    expect(application.oauth.parJetonAcces(renouvele.access_token)).toBeNull();
    expect((await rafraichir(renouvele.refresh_token)).statusCode).toBe(400);
  });

  it('un jeton de rafraîchissement présenté par un autre client est refusé', async () => {
    const initial = await couple();
    const autre = await app.inject({
      method: 'POST',
      url: '/oauth/enregistrer',
      payload: { redirect_uris: [REDIRECTION] },
    });
    const r = await rafraichir(initial.refresh_token, autre.json().client_id);
    expect(r.statusCode).toBe(400);
  });

  it('un jeton révoqué ne se rafraîchit plus', async () => {
    const initial = await couple();
    await app.inject({
      method: 'POST',
      url: '/oauth/revoquer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ token: initial.refresh_token }).toString(),
    });
    expect((await rafraichir(initial.refresh_token)).statusCode).toBe(400);
  });

  it('la révocation répond 200 même pour un jeton inconnu', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/oauth/revoquer',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ token: 'previs_rt_inexistant' }).toString(),
    });
    // Distinguer les deux cas dirait à qui essaie si un jeton a existé.
    expect(r.statusCode).toBe(200);
  });
});

describe('portée du jeton d’accès', () => {
  async function jetonAcces(): Promise<string> {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    return (await echangerCode({ code, verificateur })).json().access_token as string;
  }

  it('il vaut pour le point d’entrée MCP', async () => {
    const jeton = await jetonAcces();
    expect(application.oauth.parJetonAcces(jeton)?.email).toBe('collab@tarncompta.fr');
  });

  it('il ne vaut PAS pour l’API de l’interface', async () => {
    const jeton = await jetonAcces();
    for (const chemin of ['/api/dossiers', '/api/utilisateurs', '/api/jetons', '/api/cabinet']) {
      const r = await app.inject({
        method: 'GET',
        url: chemin,
        headers: { authorization: `Bearer ${jeton}` },
      });
      expect(r.statusCode, chemin).toBe(401);
    }
  });

  it('un jeton d’API ne vaut pas comme jeton d’accès OAuth', async () => {
    const cookie = await (async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        payload: { email: 'admin@tarncompta.fr', motDePasse: MOT_DE_PASSE },
      });
      const brut = r.headers['set-cookie'];
      return (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
    })();
    const jetonApi = (
      await app.inject({
        method: 'POST',
        url: '/api/jetons',
        headers: { cookie, origin: ORIGINE },
        payload: { libelle: 'Essai', validiteJours: 1 },
      })
    ).json().jeton as string;

    expect(application.oauth.parJetonAcces(jetonApi)).toBeNull();
    // Il reste valable là où il l'a toujours été.
    const r = await app.inject({
      method: 'GET',
      url: '/api/dossiers',
      headers: { [ENTETE_JETON]: jetonApi },
    });
    expect(r.statusCode).toBe(200);
  });

  it('désactiver le compte invalide immédiatement son jeton d’accès', async () => {
    const jeton = await jetonAcces();
    const compte = application.auth.listerUtilisateurs().find((u) => u.email === 'collab@tarncompta.fr')!;
    application.base.prepare('UPDATE utilisateurs SET actif = 0 WHERE id = ?').run(compte.id);
    expect(application.oauth.parJetonAcces(jeton)).toBeNull();
    application.base.prepare('UPDATE utilisateurs SET actif = 1 WHERE id = ?').run(compte.id);
  });

  it('le corps de formulaire n’est accepté que par les points d’entrée OAuth', async () => {
    // Un formulaire est le seul corps qu’une page tierce puisse envoyer sans
    // présentation préalable : l’API doit continuer de le refuser d’emblée.
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGINE },
      payload: new URLSearchParams({
        email: 'admin@tarncompta.fr',
        motDePasse: MOT_DE_PASSE,
      }).toString(),
    });
    expect(r.statusCode).toBe(415);
  });

  it('rien n’est conservé en clair : ni code, ni jeton', async () => {
    const { verificateur, defi } = pkce();
    const code = parametresDe((await obtenirCode({ defi })).localisation).get('code')!;
    const jetons = (await echangerCode({ code, verificateur })).json();

    for (const [table, colonne, valeur] of [
      ['oauth_codes', 'empreinte', code],
      ['oauth_jetons', 'empreinte', jetons.access_token],
      ['oauth_jetons', 'empreinte', jetons.refresh_token],
    ] as const) {
      const n = application.base
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = ?`)
        .get(valeur) as { n: number };
      expect(n.n, `${table}.${colonne}`).toBe(0);
    }
  });
});

import {
  DUREE_ACCES,
  PORTEE_DOSSIERS,
  zEnregistrementClient,
  zRequeteAutorisation,
  zRequeteJetonOauth,
  type MetadonneesAutorisation,
  type MetadonneesRessource,
  type ReponseJetonOauth,
} from '@previs/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { journaliser, type BaseDonnees } from './base.js';
import type { ServiceAuthentification } from './auth.js';
import type { ServiceCabinet } from './cabinet.js';
import type { Configuration } from './config.js';
import { ErreurOauth, type ServiceOauth } from './oauth.js';
import { LimiteurConnexions, LimiteurDebit } from './securite.js';

interface Contexte {
  base: BaseDonnees;
  auth: ServiceAuthentification;
  oauth: ServiceOauth;
  cabinet: ServiceCabinet;
  config: Configuration;
}

function echapper(texte: unknown): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Écran de consentement, rendu par le serveur.
 *
 * Il ne dépend pas de l'interface React : un connecteur ouvre cette page dans son
 * propre navigateur intégré, où le routage d'une application monopage serait une
 * fragilité de plus. Aucun script, aucune ressource distante — la politique de contenu
 * de l'application les refuserait de toute façon.
 */
/**
 * L'écran de consentement OAuth.
 *
 * Deux blocs y sont là pour une raison de sécurité, non de décoration.
 *
 * **La destination.** Un consentement qui ne dit pas OÙ part l'autorisation n'est pas un
 * consentement. Sans elle, l'enchaînement suivant fonctionnait, vérifié contre le serveur :
 * un inconnu enregistre un client — l'enregistrement dynamique de la RFC 7591 est ouvert
 * par nécessité, un connecteur MCP s'enregistre lui-même — en choisissant son nom et son
 * adresse de retour ; il envoie au comptable un lien vers cette page, qui s'affiche sur le
 * domaine du cabinet, avec le logo du cabinet, et réclame l'adresse et le mot de passe. Le
 * nom affiché était celui que l'inconnu avait choisi, « Previs — vérification de sécurité
 * obligatoire » par exemple, et « attaquant.example » n'apparaissait nulle part.
 *
 * **L'avertissement de première autorisation.** Un connecteur qui n'a jamais obtenu de jeton
 * est soit légitime et nouveau, soit l'appât ci-dessus. Le dire ne coûte rien à celui qui
 * branche son outil pour la première fois, et donne à l'autre le seul indice qui compte.
 */
/**
 * L'origine d'une adresse de retour, telle qu'elle sera contactée.
 *
 * On ne montre que le schéma et l'hôte : c'est ce qui décide où part l'autorisation, et un
 * chemin long noierait l'information. Un port non standard est conservé — « localhost:7777 »
 * n'est pas « localhost:443 ».
 */
function origineDe(uri: string): string {
  try {
    const u = new URL(uri);
    return u.origin;
  } catch {
    return uri.slice(0, 120);
  }
}

function pageConsentement(entree: {
  demandeId: string;
  nomClient: string;
  cabinet: string;
  logo: string;
  /** L'origine de l'adresse de retour, telle qu'elle sera contactée. */
  destination?: string;
  /** Vrai quand ce connecteur n'a encore jamais obtenu de jeton. */
  jamaisAutorise?: boolean;
  erreur?: string;
  courriel?: string;
}): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autoriser l’accès — ${echapper(entree.cabinet)}</title>
<style>
  :root { --bleu: #1E3FCC; --turquoise: #1AC7BD; --texte: #0C101C; --doux: #5A6272;
          --trait: #DCE3F0; --fond: #F4F6FB; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         background: var(--fond); color: var(--texte);
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .carte { width: 100%; max-width: 440px; background: #fff; border: 1px solid var(--trait);
           border-radius: 12px; box-shadow: 0 8px 28px rgba(12,16,28,.08); overflow: hidden; }
  .bandeau { background: var(--bleu); color: #fff; padding: 18px 24px; }
  .bandeau h1 { margin: 0; font-size: 17px; letter-spacing: .2px; }
  .bandeau p { margin: 4px 0 0; font-size: 12.5px; opacity: .85; }
  /* Un logo déposé peut être de n'importe quelle proportion : le cadre le contient
     sans le déformer ni le rogner. */
  .bandeau .logo { display: block; max-height: 34px; max-width: 160px; width: auto;
                   object-fit: contain; margin: 0 0 10px; }
  .corps { padding: 22px 24px 24px; }
  .demande { background: var(--fond); border: 1px solid var(--trait); border-radius: 8px;
             padding: 14px 16px; margin-bottom: 20px; }
  .demande strong { color: var(--bleu); }
  ul { margin: 10px 0 0; padding-left: 20px; color: var(--doux); font-size: 13.5px; }
  li { margin-bottom: 3px; }
  label { display: block; font-size: 12.5px; color: var(--doux); margin: 14px 0 5px; font-weight: 500; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--trait); border-radius: 7px;
          font-size: 15px; font-family: inherit; }
  input:focus { outline: 2px solid var(--turquoise); outline-offset: -1px; border-color: var(--turquoise); }
  .actions { display: flex; gap: 10px; margin-top: 22px; }
  button { flex: 1; padding: 11px 16px; border-radius: 7px; font-size: 14.5px; font-weight: 500;
           font-family: inherit; cursor: pointer; border: 1px solid var(--trait); background: #fff;
           color: var(--doux); }
  button.principal { background: var(--bleu); border-color: var(--bleu); color: #fff; }
  .erreur { background: #FDECEA; border: 1px solid #F5C6C2; color: #B3261E; padding: 10px 13px;
            border-radius: 7px; font-size: 13.5px; margin-bottom: 16px; }
  .destination { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--trait);
                 font-size: 13px; color: var(--doux); }
  .destination b { display: block; margin-top: 3px; font-size: 14px; color: var(--texte);
                   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
  .vigilance { background: #FFF6E5; border: 1px solid #F0D9A8; color: #7A4F04; padding: 11px 13px;
               border-radius: 7px; font-size: 13px; margin-bottom: 16px; }
  .vigilance b { display: block; margin-bottom: 2px; }
  .pied { margin-top: 18px; font-size: 12px; color: var(--doux); text-align: center; }
  @media (prefers-color-scheme: dark) {
    :root { --texte: #E8ECF5; --doux: #9AA3B5; --trait: #2A3244; --fond: #0E1219; }
    body { background: var(--fond); }
    .carte { background: #151A24; }
    .demande { background: #0E1219; }
    input { background: #0E1219; color: var(--texte); }
    button { background: #151A24; }
  }
</style></head><body>
<div class="carte">
  <div class="bandeau">
    ${entree.logo ? `<img class="logo" src="${echapper(entree.logo)}" alt="">` : ''}
    <h1>Autoriser l’accès à Previs</h1>
    <p>${echapper(entree.cabinet)} — prévisionnel financier</p>
  </div>
  <div class="corps">
    ${entree.erreur ? `<div class="erreur">${echapper(entree.erreur)}</div>` : ''}
    ${
      entree.jamaisAutorise
        ? `<div class="vigilance"><b>Ce connecteur n’a jamais été autorisé sur ce serveur.</b>
             Si vous ne branchez pas un outil vous-même en ce moment, fermez cette page :
             le nom ci-dessous est choisi par celui qui demande l’accès, pas par le cabinet.</div>`
        : ''
    }
    <div class="demande">
      <strong>${echapper(entree.nomClient || 'Une application')}</strong> demande à consulter et
      modifier les dossiers prévisionnels de votre compte.
      <ul>
        <li>lire et écrire dans tous les dossiers</li>
        <li>produire des documents PDF</li>
        <li>sans accès à l’administration ni aux comptes</li>
      </ul>
      ${
        entree.destination
          ? `<div class="destination">L’autorisation sera envoyée à :<b>${echapper(entree.destination)}</b></div>`
          : ''
      }
    </div>
    <form method="post" action="/oauth/autoriser">
      <input type="hidden" name="demande" value="${echapper(entree.demandeId)}">
      <label for="courriel">Adresse électronique</label>
      <input id="courriel" name="courriel" type="email" autocomplete="username" required
             value="${echapper(entree.courriel ?? '')}">
      <label for="motdepasse">Mot de passe</label>
      <input id="motdepasse" name="motdepasse" type="password" autocomplete="current-password" required>
      <div class="actions">
        <button type="submit" name="decision" value="refuser">Refuser</button>
        <button type="submit" name="decision" value="accepter" class="principal">Autoriser</button>
      </div>
    </form>
    <div class="pied">L’autorisation est révocable à tout moment depuis l’écran Administration.</div>
  </div>
</div>
</body></html>`;
}

/** Ajoute des paramètres à une adresse de redirection, en préservant les siens. */
function rediriger(base: string, parametres: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined) url.searchParams.set(cle, valeur);
  }
  return url.toString();
}

/**
 * Politique de contenu de l'écran de consentement.
 *
 * Plus étroite que celle du reste du service — la page ne charge rien — avec une
 * exception : `form-action` doit nommer l'adresse de retour du client. Certains
 * navigateurs, WebKit notamment, appliquent cette directive à la redirection qui suit
 * la soumission ; avec `'self'` seul, le retour vers le connecteur serait bloqué et le
 * flux n'aboutirait jamais.
 */
function politiqueConsentement(redirectUri?: string): string {
  let origineClient = '';
  if (redirectUri) {
    try {
      origineClient = ` ${new URL(redirectUri).origin}`;
    } catch {
      origineClient = '';
    }
  }
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    `form-action 'self'${origineClient}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function erreurOauth(reponse: FastifyReply, statut: number, code: string, description: string): void {
  // `no-store` : une réponse d'autorisation ne doit jamais être servie depuis un cache.
  reponse
    .code(statut)
    .header('cache-control', 'no-store')
    .header('pragma', 'no-cache')
    .send({ error: code, error_description: description });
}

/**
 * Monte le serveur d'autorisation OAuth 2.1.
 *
 * Le point d'entrée MCP accepte un jeton d'API pour les clients qui savent poser un
 * en-tête. Les connecteurs de claude.ai et Claude Desktop n'ouvrent qu'un formulaire
 * OAuth : sans ce serveur, il n'y a aucun moyen de les brancher.
 */
export async function enregistrerRoutesOauth(app: FastifyInstance, ctx: Contexte): Promise<void> {
  const base = ctx.config.urlPublique.replace(/\/+$/, '');
  await app.register(async (portee) => {
    // OAuth parle le formulaire, pas le JSON : la spécification impose
    // `application/x-www-form-urlencoded` sur le point d'entrée des jetons. Le parseur
    // reste enfermé dans cette portée — l'API, elle, doit continuer de refuser un corps
    // de formulaire, car c'est le seul corps qu'une page tierce puisse envoyer sans
    // présentation préalable.
    // Aucun des quatre POST de cette portée n'est joignable avec une identité déjà établie :
    // l'enregistrement de client, l'émission de jetons et la révocation n'en demandent
    // aucune, et le formulaire de consentement est justement l'étape qui la crée. Ils
    // refusent donc la décompression, comme les trois routes anonymes de l'API : le crochet
    // de détente de « @fastify/compress » précède le gestionnaire, donc tout contrôle, et
    // quatorze kilo-octets de gzip s'y détendaient en quatorze mégaoctets. Le plafond de
    // corps est posé ici aussi : celui du parseur de formulaire ne borne que le formulaire,
    // et un corps JSON retombait sur le mégaoctet global.
    const CORPS_OAUTH = { bodyLimit: 64 * 1024, decompress: false as const };

    portee.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 64 * 1024 },
      (_requete, corps, fait) => {
        try {
          fait(null, Object.fromEntries(new URLSearchParams(corps as string)));
        } catch (e) {
          fait(e as Error, undefined);
        }
      },
    );

    // Même plafond que la connexion à l'interface : l'écran de consentement est un
    // formulaire d'authentification exposé, il doit être protégé comme tel.
    const limiteur = new LimiteurConnexions(10, 15 * 60 * 1000);

    // L'enregistrement d'un client et l'ouverture d'une demande sont, par nature, des
    // écritures que personne n'a eu à s'authentifier pour obtenir. Sans plafond, une
    // boucle les répéterait jusqu'à remplir le disque. Trente par quart d'heure laissent
    // toute latitude à un connecteur qui reprend plusieurs fois sa connexion.
    const debitAnonyme = new LimiteurDebit(30, 15 * 60 * 1000);

    // L'écran de consentement porte l'identité du cabinet telle qu'elle est en place :
    // rien n'est figé ici, le nom et le logo viennent de l'écran Administration.
    const identiteCabinet = (): { cabinet: string; logo: string } => {
      const c = ctx.cabinet.lire();
      return { cabinet: c.nom, logo: c.logo };
    };

    // ─── Découverte ─────────────────────────────────────────────────────────────
    const metadonneesRessource: MetadonneesRessource = {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [PORTEE_DOSSIERS],
      bearer_methods_supported: ['header'],
      resource_documentation: `${base}/`,
    };

    const metadonneesAutorisation: MetadonneesAutorisation = {
      issuer: base,
      authorization_endpoint: `${base}/oauth/autoriser`,
      token_endpoint: `${base}/oauth/jeton`,
      registration_endpoint: `${base}/oauth/enregistrer`,
      revocation_endpoint: `${base}/oauth/revoquer`,
      scopes_supported: [PORTEE_DOSSIERS],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      // S256 seulement : « plain » ne protège de rien, le vérificateur circulant en clair.
      code_challenge_methods_supported: ['S256'],
    };

    // Les deux emplacements que les clients interrogent, avec et sans suffixe de chemin.
    for (const chemin of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      portee.get(chemin, async (_requete, reponse) =>
        reponse.header('cache-control', 'public, max-age=3600').send(metadonneesRessource),
      );
    }
    for (const chemin of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      portee.get(chemin, async (_requete, reponse) =>
        reponse.header('cache-control', 'public, max-age=3600').send(metadonneesAutorisation),
      );
    }

    // ─── Enregistrement dynamique d'un client (RFC 7591) ───────────────────────
    portee.post('/oauth/enregistrer', CORPS_OAUTH, async (requete, reponse) => {
      if (!debitAnonyme.autoriser(`enr:${requete.ip}`)) {
        return erreurOauth(
          reponse,
          429,
          'temporarily_unavailable',
          'Trop d’enregistrements depuis cette adresse. Réessayer dans quelques minutes.',
        );
      }
      try {
        const demande = zEnregistrementClient.parse(requete.body);
        const client = ctx.oauth.enregistrerClient(demande);
        journaliser(ctx.base, {
          utilisateur: '',
          origine: 'oauth',
          action: 'enregistrement_client',
          cible: client.client_id,
          detail: client.client_name,
        });
        return reponse.code(201).header('cache-control', 'no-store').send(client);
      } catch (e) {
        if (e instanceof ErreurOauth) return erreurOauth(reponse, 400, e.code, e.message);
        return erreurOauth(
          reponse,
          400,
          'invalid_client_metadata',
          'Les métadonnées du client sont invalides. Au moins une adresse de redirection est requise.',
        );
      }
    });

    // ─── Autorisation : affichage du formulaire ────────────────────────────────
    portee.get('/oauth/autoriser', async (requete, reponse) => {
      const brut = requete.query as Record<string, string>;

      // Avant toute redirection, il faut savoir que l'adresse est bien celle du client :
      // renvoyer une erreur vers une adresse non vérifiée serait une redirection ouverte.
      if (!brut.client_id || !brut.redirect_uri) {
        return erreurOauth(reponse, 400, 'invalid_request', 'client_id et redirect_uri sont requis.');
      }
      if (!ctx.oauth.redirectionAutorisee(brut.client_id, brut.redirect_uri)) {
        return erreurOauth(
          reponse,
          400,
          'invalid_request',
          'Adresse de redirection inconnue pour ce client. Aucune redirection n’est effectuée.',
        );
      }

      const versClient = (code: string, description: string) =>
        reponse
          .header('cache-control', 'no-store')
          .redirect(rediriger(brut.redirect_uri, { error: code, error_description: description, state: brut.state }));

      const analyse = zRequeteAutorisation.safeParse(brut);
      if (!analyse.success) {
        return versClient('invalid_request', 'Paramètres d’autorisation incomplets ou invalides.');
      }
      const p = analyse.data;
      if (p.response_type !== 'code') {
        return versClient('unsupported_response_type', 'Seul le type de réponse « code » est accepté.');
      }
      if (p.code_challenge_method !== 'S256') {
        return versClient('invalid_request', 'PKCE est obligatoire, en méthode S256 uniquement.');
      }
      // Indicateur de ressource (RFC 8707) : un jeton émis pour un autre serveur ne doit
      // pas pouvoir servir ici, et réciproquement.
      if (p.resource && p.resource.replace(/\/+$/, '') !== `${base}/mcp`) {
        return versClient('invalid_target', `La ressource demandée n’est pas servie ici. Attendu : ${base}/mcp`);
      }

      if (!debitAnonyme.autoriser(`dem:${requete.ip}`)) {
        return versClient(
          'temporarily_unavailable',
          'Trop de demandes depuis cette adresse. Réessayer dans quelques minutes.',
        );
      }

      const client = ctx.oauth.lireClient(p.client_id);
      const demandeId = ctx.oauth.deposerDemande({
        client_id: p.client_id,
        redirect_uri: p.redirect_uri,
        code_challenge: p.code_challenge,
        state: p.state ?? '',
        resource: p.resource ?? `${base}/mcp`,
      });

      return reponse
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('content-security-policy', politiqueConsentement(p.redirect_uri))
        .send(
          pageConsentement({
            demandeId,
            nomClient: client?.nom ?? '',
            destination: origineDe(p.redirect_uri),
            jamaisAutorise: ctx.oauth.jamaisAutorise(p.client_id),
            ...identiteCabinet(),
          }),
        );
    });

    // ─── Autorisation : traitement du formulaire ───────────────────────────────
    portee.post('/oauth/autoriser', CORPS_OAUTH, async (requete, reponse) => {
      const corps = (requete.body ?? {}) as Record<string, string>;
      const parametres = corps.demande ? ctx.oauth.lireDemande(corps.demande) : null;

      if (!parametres) {
        return reponse
          .code(400)
          .header('content-type', 'text/html; charset=utf-8')
          .header('content-security-policy', politiqueConsentement())
          .send(
            pageConsentement({
              demandeId: '',
              nomClient: '',
              ...identiteCabinet(),
              erreur: 'Cette demande d’autorisation a expiré. Relancer la connexion depuis l’application.',
            }),
          );
      }

      const versClient = (params: Record<string, string | undefined>) =>
        reponse
          .header('cache-control', 'no-store')
          .redirect(rediriger(parametres.redirect_uri, { ...params, state: parametres.state || undefined }));

      if (corps.decision !== 'accepter') {
        ctx.oauth.retirerDemande(corps.demande);
        return versClient({ error: 'access_denied', error_description: 'Autorisation refusée.' });
      }

      const courriel = String(corps.courriel ?? '').trim().toLowerCase();
      const reafficher = (message: string) =>
        reponse
          .code(401)
          .header('content-type', 'text/html; charset=utf-8')
          .header('cache-control', 'no-store')
          .header('content-security-policy', politiqueConsentement(parametres.redirect_uri))
          .send(
            pageConsentement({
              demandeId: corps.demande,
              nomClient: ctx.oauth.lireClient(parametres.client_id)?.nom ?? '',
              destination: origineDe(parametres.redirect_uri),
              jamaisAutorise: ctx.oauth.jamaisAutorise(parametres.client_id),
              ...identiteCabinet(),
              erreur: message,
              courriel,
            }),
          );

      const cles = [`oauth:${requete.ip}`, `oauth:${courriel}`];
      if (cles.some((c) => limiteur.bloque(c))) {
        return reafficher('Trop de tentatives. Réessayer dans quelques minutes.');
      }

      const valide = await ctx.auth.verifierIdentifiants(courriel, String(corps.motdepasse ?? ''));
      if (!valide) {
        for (const c of cles) limiteur.echec(c);
        journaliser(ctx.base, {
          utilisateur: courriel,
          origine: 'oauth',
          action: 'consentement_refuse',
          detail: requete.ip,
        });
        return reafficher('Adresse ou mot de passe incorrect.');
      }
      for (const c of cles) limiteur.succes(c);

      const utilisateur = ctx.auth
        .listerUtilisateurs()
        .find((u) => u.email === courriel && u.actif);
      if (!utilisateur) return reafficher('Ce compte n’est pas actif.');

      const code = ctx.oauth.emettreCode({
        clientId: parametres.client_id,
        utilisateurId: utilisateur.id,
        redirectUri: parametres.redirect_uri,
        codeChallenge: parametres.code_challenge,
        ressource: parametres.resource,
      });
      ctx.oauth.retirerDemande(corps.demande);

      journaliser(ctx.base, {
        utilisateur: utilisateur.nom,
        origine: 'oauth',
        action: 'consentement_accorde',
        cible: parametres.client_id,
      });

      return versClient({ code });
    });

    // ─── Émission des jetons ──────────────────────────────────────────────────
    portee.post('/oauth/jeton', CORPS_OAUTH, async (requete, reponse) => {
      const analyse = zRequeteJetonOauth.safeParse(requete.body ?? {});
      if (!analyse.success) {
        return erreurOauth(reponse, 400, 'invalid_request', 'Paramètres de la requête de jeton invalides.');
      }
      const p = analyse.data;

      try {
        if (p.grant_type === 'authorization_code') {
          if (!p.code || !p.redirect_uri || !p.client_id || !p.code_verifier) {
            return erreurOauth(
              reponse,
              400,
              'invalid_request',
              'code, redirect_uri, client_id et code_verifier sont requis.',
            );
          }
          const { utilisateurId, ressource } = ctx.oauth.consommerCode({
            code: p.code,
            clientId: p.client_id,
            redirectUri: p.redirect_uri,
            codeVerifier: p.code_verifier,
          });
          const jetons = ctx.oauth.emettreJetons({ clientId: p.client_id, utilisateurId, ressource });
          const corps: ReponseJetonOauth = {
            access_token: jetons.acces,
            token_type: 'Bearer',
            expires_in: DUREE_ACCES,
            refresh_token: jetons.rafraichissement,
            scope: PORTEE_DOSSIERS,
          };
          return reponse.header('cache-control', 'no-store').send(corps);
        }

        if (p.grant_type === 'refresh_token') {
          if (!p.refresh_token || !p.client_id) {
            return erreurOauth(reponse, 400, 'invalid_request', 'refresh_token et client_id sont requis.');
          }
          const r = ctx.oauth.rafraichir({ jeton: p.refresh_token, clientId: p.client_id });
          const corps: ReponseJetonOauth = {
            access_token: r.acces,
            token_type: 'Bearer',
            expires_in: DUREE_ACCES,
            refresh_token: r.rafraichissement,
            scope: PORTEE_DOSSIERS,
          };
          return reponse.header('cache-control', 'no-store').send(corps);
        }

        return erreurOauth(
          reponse,
          400,
          'unsupported_grant_type',
          'Seuls « authorization_code » et « refresh_token » sont acceptés.',
        );
      } catch (e) {
        if (e instanceof ErreurOauth) return erreurOauth(reponse, 400, e.code, e.message);
        requete.log.error(e);
        return erreurOauth(reponse, 500, 'server_error', 'Erreur interne du serveur d’autorisation.');
      }
    });

    // ─── Révocation (RFC 7009) ────────────────────────────────────────────────
    portee.post('/oauth/revoquer', CORPS_OAUTH, async (requete, reponse) => {
      const corps = (requete.body ?? {}) as Record<string, string>;
      // La spécification impose de répondre 200 même pour un jeton inconnu : distinguer
      // les deux cas dirait à qui essaie si un jeton a existé.
      if (corps.token) ctx.oauth.revoquer(corps.token);
      return reponse.code(200).header('cache-control', 'no-store').send({});
    });
  });
}

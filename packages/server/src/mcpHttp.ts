import { ENTETE_JETON, ErreurDepot, type DepotDossiers } from '@previs/core';
import type { FastifyInstance } from 'fastify';
import { jetonDeRequete, type ServiceAuthentification } from './auth.js';
import type { ServiceOauth } from './oauth.js';
import type { LimiteurDebit } from './securite.js';

/**
 * Le dépôt vu par le serveur MCP : le même, sauf que l'export PDF y est plafonné.
 *
 * L'outil « generer_pdf » lance un Chromium complet — huit cents millisecondes mesurées —
 * et rien, dans le protocole, ne limite le nombre d'appels d'un client. La route HTTP
 * `POST /api/dossiers/:id/pdf` compte les siens depuis toujours ; ce chemin-ci ne comptait
 * rien, et un porteur de jeton pouvait boucler l'outil jusqu'à saturer le processeur du
 * serveur. La clé du compteur est l'identifiant du titulaire, la même que celle de la
 * route : le budget est unique, quel que soit le canal emprunté.
 *
 * Le dépôt réel sert de prototype plutôt que d'être recopié méthode par méthode : une
 * liste écrite à la main devrait être tenue à jour à chaque ajout au dépôt, et la méthode
 * oubliée disparaîtrait silencieusement du serveur MCP.
 */
export function bornerExportPdf(
  depot: DepotDossiers,
  autoriser: () => boolean,
): DepotDossiers {
  return Object.create(depot, {
    pdf: {
      value: async (id: string): Promise<Uint8Array> => {
        if (!autoriser()) {
          throw new ErreurDepot(
            'interdit',
            'Trop d’exports PDF demandés sur ce compte : patienter quelques minutes. Le ' +
              'dossier reste exportable depuis l’interface, bouton « Exporter le dossier ».',
          );
        }
        return depot.pdf(id);
      },
    },
  }) as DepotDossiers;
}

/**
 * Monte le serveur MCP sur `/mcp`.
 *
 * L'authentification se fait exclusivement par jeton d'API : jamais par cookie, pour
 * qu'aucune page tierce ne puisse déclencher d'écriture depuis le navigateur d'un
 * utilisateur connecté.
 */
export async function monterMcpHttp(
  app: FastifyInstance,
  ctx: {
    auth: ServiceAuthentification;
    depot: DepotDossiers;
    oauth: ServiceOauth;
    /** Compteur d'exports PDF, partagé avec la route HTTP. */
    debitPdf: LimiteurDebit;
    urlPublique: string;
  },
): Promise<void> {
  const { creerServeurMcp, traiterRequeteHttp } = await import('@previs/mcp');

  app.all('/mcp', async (requete, reponse) => {
    const jeton = jetonDeRequete(requete);
    // Deux sortes de porteurs : un jeton d'API, posé à la main par un client qui sait
    // le faire, ou un jeton d'accès OAuth, obtenu par un connecteur.
    const utilisateur = jeton ? (ctx.oauth.parJetonAcces(jeton) ?? ctx.auth.parJeton(jeton)) : null;

    if (!utilisateur) {
      // C'est cet en-tête qui permet à un client OAuth de découvrir le serveur
      // d'autorisation : sans lui, un connecteur ne sait pas où s'authentifier.
      const base = ctx.urlPublique.replace(/\/+$/, '');
      return reponse
        .code(401)
        .header(
          'www-authenticate',
          `Bearer realm="Previs", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        )
        .send({
          erreur:
            'Autorisation requise. Un connecteur passe par OAuth ; un client qui pose ses ' +
            `en-têtes peut employer « Authorization: Bearer previs_… » ou ${ENTETE_JETON}.`,
          code: 'non_authentifie',
        });
    }
    if (utilisateur.role === 'lecteur') {
      return reponse
        .code(403)
        .send({ erreur: 'Ce jeton n’autorise que la lecture.', code: 'interdit' });
    }

    // Le nom porte à la fois l'assistant et le titulaire du jeton : l'interface et
    // l'historique montrent ainsi qui a écrit, et par quel canal.
    const serveur = creerServeurMcp(
      bornerExportPdf(ctx.depot, () => ctx.debitPdf.autoriser(utilisateur.id)),
      {
        id: utilisateur.id,
        nom: `Assistant · ${utilisateur.nom}`,
        origine: 'mcp',
      },
    );

    return traiterRequeteHttp(serveur, requete, reponse);
  });
}

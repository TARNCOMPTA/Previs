import { ENTETE_JETON, type DepotDossiers } from '@previs/core';
import type { FastifyInstance } from 'fastify';
import { jetonDeRequete, type ServiceAuthentification } from './auth.js';
import type { ServiceOauth } from './oauth.js';

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
    const serveur = creerServeurMcp(ctx.depot, {
      id: utilisateur.id,
      nom: `Assistant · ${utilisateur.nom}`,
      origine: 'mcp',
    });

    return traiterRequeteHttp(serveur, requete, reponse);
  });
}

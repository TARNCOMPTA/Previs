import { ENTETE_JETON, type DepotDossiers } from '@previs/core';
import type { FastifyInstance } from 'fastify';
import type { ServiceAuthentification } from './auth.js';

/**
 * Monte le serveur MCP sur `/mcp`.
 *
 * L'authentification se fait exclusivement par jeton d'API : jamais par cookie, pour
 * qu'aucune page tierce ne puisse déclencher d'écriture depuis le navigateur d'un
 * utilisateur connecté.
 */
export async function monterMcpHttp(
  app: FastifyInstance,
  ctx: { auth: ServiceAuthentification; depot: DepotDossiers },
): Promise<void> {
  const { creerServeurMcp, traiterRequeteHttp } = await import('@previs/mcp');

  app.all('/mcp', async (requete, reponse) => {
    const entete = requete.headers[ENTETE_JETON];
    const jeton = Array.isArray(entete) ? entete[0] : entete;
    const utilisateur = jeton ? ctx.auth.parJeton(jeton) : null;

    if (!utilisateur) {
      return reponse.code(401).send({
        erreur: `Jeton d’API absent ou invalide. Transmettre l’en-tête ${ENTETE_JETON}.`,
        code: 'non_authentifie',
      });
    }
    if (utilisateur.role === 'lecteur') {
      return reponse
        .code(403)
        .send({ erreur: 'Ce jeton n’autorise que la lecture.', code: 'interdit' });
    }

    const serveur = creerServeurMcp(ctx.depot, {
      id: utilisateur.id,
      nom: utilisateur.nom,
      origine: 'mcp',
    });

    return traiterRequeteHttp(serveur, requete, reponse);
  });
}

import {
  ENTETE_JETON,
  ErreurDepot,
  type Auteur,
  type DepotDossiers,
  type DossierEnregistre,
  type RequeteCreation,
  type RequeteEnregistrement,
  type RequetePatch,
  type Resultats,
  type ResultatPatch,
  type ResumeDossier,
  type ResumeVersion,
} from '@previs/core';

/**
 * Accès aux dossiers par l'API HTTP de Previs.
 *
 * C'est cette implémentation qu'utilise le serveur MCP lancé sur le poste de
 * l'utilisateur : il parle au même serveur que l'interface, avec les mêmes règles
 * de version, si bien que le modèle et l'humain ne peuvent pas s'écraser mutuellement.
 */
export function creerDepotHttp(urlBase: string, jeton: string): DepotDossiers {
  const racine = urlBase.replace(/\/+$/, '');

  async function appeler<T>(
    chemin: string,
    options: { methode?: string; corps?: unknown; brut?: boolean } = {},
  ): Promise<T> {
    let reponse: Response;
    try {
      reponse = await fetch(`${racine}${chemin}`, {
        method: options.methode ?? 'GET',
        headers: {
          [ENTETE_JETON]: jeton,
          ...(options.corps !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: options.corps !== undefined ? JSON.stringify(options.corps) : undefined,
      });
    } catch (e) {
      throw new ErreurDepot(
        'erreur_interne',
        `Le serveur Previs est injoignable à l’adresse ${racine} (${e instanceof Error ? e.message : e}).`,
      );
    }

    if (!reponse.ok) {
      let details: { erreur?: string; code?: string; details?: unknown } = {};
      try {
        details = (await reponse.json()) as typeof details;
      } catch {
        details = { erreur: `Réponse ${reponse.status} du serveur.` };
      }
      const code = (details.code ?? 'erreur_interne') as ErreurDepot['code'];
      throw new ErreurDepot(code, details.erreur ?? `Erreur ${reponse.status}.`, details.details);
    }

    if (options.brut) return new Uint8Array(await reponse.arrayBuffer()) as unknown as T;
    return (await reponse.json()) as T;
  }

  const depot: DepotDossiers = {
    lister: () => appeler<ResumeDossier[]>('/api/dossiers'),

    lire: async (id) => {
      try {
        return await appeler<DossierEnregistre>(`/api/dossiers/${id}`);
      } catch (e) {
        if (e instanceof ErreurDepot && e.code === 'introuvable') return null;
        throw e;
      }
    },

    creer: (requete: RequeteCreation) =>
      appeler<DossierEnregistre>('/api/dossiers', { methode: 'POST', corps: requete }),

    enregistrer: (id, requete: RequeteEnregistrement) =>
      appeler<DossierEnregistre>(`/api/dossiers/${id}`, { methode: 'PUT', corps: requete }),

    appliquer: (id, requete: RequetePatch) =>
      appeler<ResultatPatch>(`/api/dossiers/${id}`, { methode: 'PATCH', corps: requete }),

    supprimer: async (id) => {
      await appeler(`/api/dossiers/${id}`, { methode: 'DELETE' });
    },

    dupliquer: (id) =>
      appeler<DossierEnregistre>(`/api/dossiers/${id}/dupliquer`, { methode: 'POST' }),

    versions: (id) => appeler<ResumeVersion[]>(`/api/dossiers/${id}/versions`),

    lireVersion: async (id, version) => {
      try {
        return await appeler<DossierEnregistre>(`/api/dossiers/${id}/versions/${version}`);
      } catch (e) {
        if (e instanceof ErreurDepot && e.code === 'introuvable') return null;
        throw e;
      }
    },

    restaurer: (id, version) =>
      appeler<DossierEnregistre>(`/api/dossiers/${id}/versions/${version}/restaurer`, {
        methode: 'POST',
      }),

    calculer: (id) => appeler<Resultats>(`/api/dossiers/${id}/calculer`, { methode: 'POST' }),

    pdf: (id) => appeler<Uint8Array>(`/api/dossiers/${id}/pdf`, { methode: 'POST', brut: true }),
  };

  return depot;
}

/** Auteur des écritures faites par le serveur MCP autonome. */
export const AUTEUR_MCP: Auteur = { id: 'mcp', nom: 'Assistant', origine: 'mcp' };

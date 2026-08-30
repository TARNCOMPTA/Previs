import type {
  Cabinet,
  DossierEnregistre,
  ErreurApi,
  JetonApi,
  RequeteCreation,
  ResumeDossier,
  ResumeVersion,
  Utilisateur,
  Operation,
  Dossier,
} from '@previs/core';

/** Erreur remontée par l'API, avec son code métier et ses détails. */
export class ErreurRequete extends Error {
  constructor(
    readonly code: ErreurApi['code'],
    message: string,
    readonly details?: unknown,
    readonly statut?: number,
  ) {
    super(message);
    this.name = 'ErreurRequete';
  }
}

type Options = { methode?: string; corps?: unknown };

/** Déclenché sur toute réponse 401 : la coquille applicative renvoie à la connexion. */
let surDeconnexion: (() => void) | null = null;
export function definirSurDeconnexion(rappel: () => void): void {
  surDeconnexion = rappel;
}

async function appeler<T>(chemin: string, options: Options = {}): Promise<T> {
  const reponse = await fetch(chemin, {
    method: options.methode ?? 'GET',
    credentials: 'same-origin',
    headers: options.corps !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.corps !== undefined ? JSON.stringify(options.corps) : undefined,
  });

  if (reponse.status === 401) {
    surDeconnexion?.();
    throw new ErreurRequete('non_authentifie', 'Session expirée. Veuillez vous reconnecter.', undefined, 401);
  }

  if (!reponse.ok) {
    let charge: Partial<ErreurApi> = {};
    try {
      charge = (await reponse.json()) as Partial<ErreurApi>;
    } catch {
      charge = { erreur: `Le serveur a répondu ${reponse.status}.` };
    }
    throw new ErreurRequete(
      charge.code ?? 'erreur_interne',
      charge.erreur ?? 'Erreur inattendue.',
      charge.details,
      reponse.status,
    );
  }

  if (reponse.status === 204) return undefined as T;
  return (await reponse.json()) as T;
}

export const api = {
  // ─── Authentification ─────────────────────────────────────────────────────
  connexion: (email: string, motDePasse: string) =>
    appeler<{ utilisateur: Utilisateur }>('/api/auth/connexion', {
      methode: 'POST',
      corps: { email, motDePasse },
    }),
  deconnexion: () => appeler<{ deconnecte: boolean }>('/api/auth/deconnexion', { methode: 'POST' }),
  moi: () => appeler<{ utilisateur: Utilisateur; origine: string }>('/api/auth/moi'),
  changerMotDePasse: (ancien: string, nouveau: string) =>
    appeler<{ modifie: boolean }>('/api/auth/motdepasse', { methode: 'POST', corps: { ancien, nouveau } }),

  // ─── Dossiers ─────────────────────────────────────────────────────────────
  listerDossiers: () => appeler<ResumeDossier[]>('/api/dossiers'),
  lireDossier: (id: string) => appeler<DossierEnregistre>(`/api/dossiers/${id}`),
  creerDossier: (requete: RequeteCreation) =>
    appeler<DossierEnregistre>('/api/dossiers', { methode: 'POST', corps: requete }),
  enregistrerDossier: (id: string, dossier: Dossier, versionAttendue: number, commentaire = '') =>
    appeler<DossierEnregistre>(`/api/dossiers/${id}`, {
      methode: 'PUT',
      corps: { dossier, versionAttendue, commentaire },
    }),
  appliquerOperations: (id: string, operations: Operation[], commentaire = '') =>
    appeler<{ dossier: DossierEnregistre; journal: string[]; erreurs: string[] }>(`/api/dossiers/${id}`, {
      methode: 'PATCH',
      corps: { operations, commentaire },
    }),
  supprimerDossier: (id: string) => appeler<{ supprime: boolean }>(`/api/dossiers/${id}`, { methode: 'DELETE' }),
  dupliquerDossier: (id: string) =>
    appeler<DossierEnregistre>(`/api/dossiers/${id}/dupliquer`, { methode: 'POST' }),
  versions: (id: string) => appeler<ResumeVersion[]>(`/api/dossiers/${id}/versions`),
  definirLogoDossier: (id: string, logo: string) =>
    appeler<DossierEnregistre>(`/api/dossiers/${id}/logo`, { methode: 'PUT', corps: { logo } }),

  // ─── Identité du cabinet ──────────────────────────────────────────────────
  lireCabinet: () => appeler<Cabinet>('/api/cabinet'),
  enregistrerCabinet: (modifications: Partial<Cabinet>) =>
    appeler<Cabinet>('/api/cabinet', { methode: 'PUT', corps: modifications }),
  restaurerVersion: (id: string, version: number) =>
    appeler<DossierEnregistre>(`/api/dossiers/${id}/versions/${version}/restaurer`, { methode: 'POST' }),

  /** Télécharge le dossier au format PDF et déclenche l'enregistrement du fichier. */
  async telechargerPdf(id: string, nomFichier: string): Promise<void> {
    const reponse = await fetch(`/api/dossiers/${id}/pdf`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!reponse.ok) {
      const details = (await reponse.json().catch(() => ({}))) as Partial<ErreurApi>;
      throw new ErreurRequete(
        details.code ?? 'erreur_interne',
        details.erreur ?? 'La génération du PDF a échoué.',
      );
    }
    const contenu = await reponse.blob();
    const url = URL.createObjectURL(contenu);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.append(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
  },

  // ─── Comptes et jetons ────────────────────────────────────────────────────
  listerUtilisateurs: () => appeler<Utilisateur[]>('/api/utilisateurs'),
  creerUtilisateur: (entree: { email: string; nom: string; motDePasse: string; role: string }) =>
    appeler<Utilisateur>('/api/utilisateurs', { methode: 'POST', corps: entree }),
  modifierUtilisateur: (id: string, champs: Record<string, unknown>) =>
    appeler<Utilisateur>(`/api/utilisateurs/${id}`, { methode: 'PATCH', corps: champs }),
  supprimerUtilisateur: (id: string) =>
    appeler<{ supprime: boolean }>(`/api/utilisateurs/${id}`, { methode: 'DELETE' }),

  listerJetons: () => appeler<JetonApi[]>('/api/jetons'),
  creerJeton: (libelle: string, validiteJours: number) =>
    appeler<{ id: string; libelle: string; jeton: string; expireLe: string | null }>('/api/jetons', {
      methode: 'POST',
      corps: { libelle, validiteJours },
    }),
  supprimerJeton: (id: string) => appeler<{ supprime: boolean }>(`/api/jetons/${id}`, { methode: 'DELETE' }),
};

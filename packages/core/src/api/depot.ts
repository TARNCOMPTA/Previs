import type { Resultats } from '../engine/types.js';
import type {
  DossierEnregistre,
  RequeteCreation,
  RequeteEnregistrement,
  RequetePatch,
  ResumeDossier,
  ResumeVersion,
} from './contract.js';

/** Identité de l'auteur d'une écriture, journalisée dans l'historique des versions. */
export interface Auteur {
  id: string;
  nom: string;
  origine: 'interface' | 'mcp' | 'import';
}

/** Résultat d'une écriture par opérations, tel que le serveur MCP le restitue au LLM. */
export interface ResultatPatch {
  dossier: DossierEnregistre;
  journal: string[];
  erreurs: string[];
}

/**
 * Accès aux dossiers prévisionnels, indépendamment du support.
 *
 * Le serveur HTTP l'implémente sur sa base SQLite ; le serveur MCP en fournit une
 * implémentation qui appelle cette même API à distance. Le serveur MCP peut donc
 * fonctionner aussi bien monté dans le serveur qu'exécuté sur le poste de l'utilisateur.
 */
export interface DepotDossiers {
  lister(): Promise<ResumeDossier[]>;
  lire(id: string): Promise<DossierEnregistre | null>;
  creer(requete: RequeteCreation, auteur: Auteur): Promise<DossierEnregistre>;
  enregistrer(id: string, requete: RequeteEnregistrement, auteur: Auteur): Promise<DossierEnregistre>;
  appliquer(id: string, requete: RequetePatch, auteur: Auteur): Promise<ResultatPatch>;
  supprimer(id: string): Promise<void>;
  dupliquer(id: string, auteur: Auteur): Promise<DossierEnregistre>;
  versions(id: string): Promise<ResumeVersion[]>;
  lireVersion(id: string, version: number): Promise<DossierEnregistre | null>;
  restaurer(id: string, version: number, auteur: Auteur): Promise<DossierEnregistre>;
  calculer(id: string): Promise<Resultats>;
  pdf(id: string): Promise<Uint8Array>;
}

/** Erreur métier portant un code du contrat, convertie en réponse HTTP par le serveur. */
export class ErreurDepot extends Error {
  constructor(
    readonly code:
      | 'introuvable'
      | 'conflit_version'
      | 'donnees_invalides'
      | 'interdit'
      | 'erreur_interne',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ErreurDepot';
  }
}

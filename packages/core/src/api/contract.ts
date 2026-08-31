import { z } from 'zod';
import { zCabinet, zLogoFacultatif } from '../model/cabinet.js';
import { zDossier, type Dossier } from '../model/dossier.js';
import { zLigneCharge, zLignePersonnel } from '../model/charges.js';
import { zApport, zCreditBail, zEmprunt, zSubvention } from '../model/financements.js';
import { zCession, zLigneInvestissement } from '../model/investissements.js';
import { zLigneRecette } from '../model/recettes.js';
import { zLigneDistribution, zLigneExceptionnelle, zLignePassifDeclare } from '../model/autres.js';

/** Rôles applicatifs. Un `admin` gère les comptes et les jetons d'API. */
export const zRole = z.enum(['admin', 'collaborateur', 'lecteur']);
export type Role = z.infer<typeof zRole>;

export interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  role: Role;
  creeLe: string;
  derniereConnexion: string | null;
  actif: boolean;
}

/** Fiche résumée d'un dossier, pour la liste d'accueil. */
export interface ResumeDossier {
  id: string;
  nom: string;
  client: string;
  regime: string;
  typeDossier: string;
  nbExercices: number;
  anneeDebut: string;
  /** Chiffre d'affaires du premier exercice, pour l'aperçu de la liste. */
  caPremierExercice: number;
  version: number;
  creeLe: string;
  modifieLe: string;
  modifiePar: string;
  /** Faux si le dernier calcul enregistré présentait un contrôle en erreur. */
  coherent: boolean;
  /** Logo du client, en URI de données. Chaîne vide si aucun n'a été déposé. */
  logo: string;
}

/** Dossier complet tel que renvoyé par l'API. */
export interface DossierEnregistre extends ResumeDossier {
  dossier: Dossier;
}

/**
 * Requête de dépôt d'un logo, pour un dossier client ou pour le cabinet.
 *
 * Le logo est une pièce de présentation, pas une donnée financière : il vit à côté
 * du dossier et non dans son contenu versionné. Restaurer une version antérieure ne
 * doit pas faire disparaître le logo du client, et l'archiver à chaque écriture
 * multiplierait la même image dans tout l'historique.
 */
export const zRequeteLogo = z.object({
  logo: zLogoFacultatif,
});

export const zRequeteCabinet = zCabinet.partial();

export interface ResumeVersion {
  version: number;
  creeLe: string;
  auteur: string;
  /** Description de la modification, renseignée par l'interface ou par le LLM. */
  commentaire: string;
  origine: 'interface' | 'mcp' | 'import';
}

/** Listes de lignes adressables par le LLM via une opération de modification. */
export const zCheminListe = z.enum([
  'investissements.lignes',
  'investissements.cessions',
  'financements.apports',
  'financements.emprunts',
  'financements.subventions',
  'financements.creditsBaux',
  'charges.lignes',
  'charges.personnel',
  'recettes.lignes',
  'autres.exceptionnels',
  'autres.distributions',
  'autres.passifDeclare',
]);
export type CheminListe = z.infer<typeof zCheminListe>;

export const LIBELLES_CHEMIN_LISTE: Record<CheminListe, string> = {
  'investissements.lignes': 'Investissements',
  'investissements.cessions': 'Cessions d’immobilisations',
  'financements.apports': 'Apports et comptes courants',
  'financements.emprunts': 'Emprunts',
  'financements.subventions': 'Subventions',
  'financements.creditsBaux': 'Crédits-baux',
  'charges.lignes': 'Charges d’exploitation',
  'charges.personnel': 'Personnel et rémunérations',
  'recettes.lignes': 'Recettes',
  'autres.exceptionnels': 'Produits et charges exceptionnels',
  'autres.distributions': 'Dividendes et prélèvements',
  'autres.passifDeclare': 'Passif déclaré (plan de continuation)',
};

/**
 * Opération de modification atomique d'un dossier.
 *
 * Ces opérations sont la surface d'écriture du serveur MCP : elles permettent au LLM
 * de modifier une ligne sans réécrire tout le dossier, donc sans écraser une saisie
 * faite entre-temps dans l'interface.
 */
export const zOperation = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('definir'),
    /** Chemin pointé, en notation pointée : `parametres.tva.regime`, `identite.raisonSociale`. */
    chemin: z.string().min(1).max(200),
    valeur: z.unknown(),
  }),
  z.object({
    action: z.literal('ajouter_ligne'),
    liste: zCheminListe,
    /** Ligne partielle : les champs absents prennent leur valeur par défaut. */
    ligne: z.record(z.unknown()),
  }),
  z.object({
    action: z.literal('modifier_ligne'),
    liste: zCheminListe,
    id: z.string().min(1),
    champs: z.record(z.unknown()),
  }),
  z.object({
    action: z.literal('supprimer_ligne'),
    liste: zCheminListe,
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal('vider_liste'),
    liste: zCheminListe,
  }),
]);
export type Operation = z.infer<typeof zOperation>;

export const zRequetePatch = z.object({
  operations: z.array(zOperation).min(1).max(500),
  commentaire: z.string().max(500).default(''),
  /**
   * Version attendue du dossier. Si elle ne correspond pas, l'API répond 409 :
   * le LLM doit relire le dossier avant de réécrire.
   */
  versionAttendue: z.number().int().optional(),
});
export type RequetePatch = z.infer<typeof zRequetePatch>;

export const zRequeteEnregistrement = z.object({
  dossier: zDossier,
  commentaire: z.string().max(500).default(''),
  versionAttendue: z.number().int().optional(),
});
export type RequeteEnregistrement = z.infer<typeof zRequeteEnregistrement>;

export const zRequeteCreation = z.object({
  nom: z.string().min(1).max(200),
  dossier: zDossier.optional(),
  /** Modèle de départ : pré-remplit les charges usuelles du régime choisi. */
  modele: z.enum(['vide', 'IS', 'BNC', 'BIC_IR']).default('vide'),
});
export type RequeteCreation = z.infer<typeof zRequeteCreation>;

export const zRequeteConnexion = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(1).max(200),
});

export const zRequeteUtilisateur = z.object({
  email: z.string().email(),
  nom: z.string().min(1).max(150),
  motDePasse: z.string().min(10).max(200),
  role: zRole.default('collaborateur'),
});

export const zRequeteJeton = z.object({
  libelle: z.string().min(1).max(120),
  /** Nombre de jours de validité. 0 = sans expiration. */
  validiteJours: z.number().int().min(0).max(3650).default(365),
});

export interface JetonApi {
  id: string;
  libelle: string;
  /** Quatre derniers caractères, pour reconnaître le jeton dans la liste. */
  apercu: string;
  creeLe: string;
  expireLe: string | null;
  derniereUtilisation: string | null;
}

/** Format d'erreur uniforme renvoyé par l'API. */
export interface ErreurApi {
  erreur: string;
  code:
    | 'non_authentifie'
    /**
     * Un identifiant soumis a été refusé : mot de passe faux, clé d'accès non reconnue.
     *
     * Distinct de « non_authentifie », qui signale une session absente ou expirée. Les
     * deux répondent 401, mais l'interface doit les traiter autrement : le premier
     * s'affiche à l'écran où l'on vient de saisir, le second renvoie à la connexion.
     */
    | 'identifiant_refuse'
    | 'interdit'
    | 'introuvable'
    | 'conflit_version'
    | 'donnees_invalides'
    | 'erreur_interne';
  details?: unknown;
}

/** En-tête portant le jeton d'API du serveur MCP. */
export const ENTETE_JETON = 'x-previs-token';

/** Préfixe des jetons d'API, pour les repérer facilement. */
export const PREFIXE_JETON = 'previs_';

/**
 * Schéma zod de chaque liste de lignes.
 *
 * Sert à compléter les valeurs par défaut d'une ligne créée depuis l'interface : le
 * moteur ne valide plus à chaque calcul, c'est donc à la création que la ligne doit
 * être rendue complète.
 */
export const SCHEMAS_LIGNE = {
  'investissements.lignes': zLigneInvestissement,
  'investissements.cessions': zCession,
  'financements.apports': zApport,
  'financements.emprunts': zEmprunt,
  'financements.subventions': zSubvention,
  'financements.creditsBaux': zCreditBail,
  'charges.lignes': zLigneCharge,
  'charges.personnel': zLignePersonnel,
  'recettes.lignes': zLigneRecette,
  'autres.exceptionnels': zLigneExceptionnelle,
  'autres.distributions': zLigneDistribution,
  'autres.passifDeclare': zLignePassifDeclare,
} as const satisfies Record<CheminListe, z.ZodTypeAny>;

/** Complète une ligne partielle avec toutes les valeurs par défaut de son schéma. */
export function completerLigne(liste: CheminListe, ligne: Record<string, unknown>): Record<string, unknown> {
  return SCHEMAS_LIGNE[liste].parse(ligne) as Record<string, unknown>;
}

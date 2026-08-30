import { z } from 'zod';
import { zExercice, zLigneBase, zMois, zMontant, zTaux, EXERCICES_MAX, LIGNES_MAX } from './common.js';

/** Grande masse du bilan à laquelle se rattache l'immobilisation. */
export const zCategorieInvestissement = z.enum([
  'incorporel',
  'corporel',
  'financier',
  'stock_initial',
  'tresorerie_demarrage',
  'frais_etablissement',
]);
export type CategorieInvestissement = z.infer<typeof zCategorieInvestissement>;

export const LIBELLES_CATEGORIE_INVESTISSEMENT: Record<CategorieInvestissement, string> = {
  incorporel: 'Immobilisations incorporelles',
  corporel: 'Immobilisations corporelles',
  financier: 'Immobilisations financières',
  stock_initial: 'Stock de départ',
  tresorerie_demarrage: 'Trésorerie de démarrage',
  frais_etablissement: 'Frais d’établissement',
};

export const zModeAmortissement = z.enum(['lineaire', 'degressif', 'aucun']);
export type ModeAmortissement = z.infer<typeof zModeAmortissement>;

/**
 * Une ligne d'investissement.
 *
 * Les catégories `stock_initial`, `tresorerie_demarrage` et `financier` ne sont jamais
 * amorties : elles figurent au plan de financement comme un besoin, mais ne génèrent
 * aucune dotation. Les frais d'établissement sont amortissables sur 1 à 5 ans.
 */
export const zLigneInvestissement = zLigneBase.extend({
  categorie: zCategorieInvestissement.default('corporel'),
  /** Numéro de compte du plan comptable général (facultatif, 2xxxxx). */
  compte: z.string().max(10).optional(),
  montantHT: zMontant.default(0),
  tauxTva: zTaux.default(20),
  /** TVA récupérable sur l'acquisition (faux pour un véhicule de tourisme, par exemple). */
  tvaRecuperable: z.boolean().default(true),
  /** Exercice d'acquisition (0 = premier exercice). */
  exercice: zExercice.default(0),
  /** Mois d'acquisition au sein de l'exercice (1 = premier mois). */
  mois: zMois.default(1),
  modeAmortissement: zModeAmortissement.default('lineaire'),
  /** Durée d'amortissement en années. Ignorée si `modeAmortissement` vaut `aucun`. */
  dureeAmortissementAnnees: z.number().min(0).max(50).default(5),
  /** Valeur résiduelle non amortie (terrain inclus dans un ensemble immobilier, par ex.). */
  valeurResiduelle: zMontant.default(0),
  /** Identifiant d'un emprunt de la section Financement qui finance spécifiquement cette ligne. */
  financeParEmpruntId: z.string().max(64).optional(),
  /** Décaissement étalé : nombre de mois sur lequel l'acquisition est réglée (1 = comptant). */
  echelonnementMois: z.number().int().min(1).max(36).default(1),
});
export type LigneInvestissement = z.infer<typeof zLigneInvestissement>;

/** Une immobilisation cédée en cours de prévisionnel (produit de cession + sortie d'actif). */
export const zCession = zLigneBase.extend({
  /** Immobilisation cédée, si elle figure dans le plan d'investissement. */
  investissementId: z.string().max(64).optional(),
  exercice: zExercice.default(0),
  mois: zMois.default(12),
  prixCessionHT: zMontant.default(0),
  /** Valeur nette comptable à la date de cession. Laisser à 0 pour la laisser calculer. */
  vncForcee: zMontant.optional(),
  tauxTva: zTaux.default(20),
});
export type Cession = z.infer<typeof zCession>;

export const zSectionInvestissements = z.object({
  lignes: z.array(zLigneInvestissement).max(LIGNES_MAX).default([]),
  cessions: z.array(zCession).max(LIGNES_MAX).default([]),
});
export type SectionInvestissements = z.infer<typeof zSectionInvestissements>;

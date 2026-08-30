import { z } from 'zod';
import { REPARTITION_LINEAIRE, zLigneBase, zMontant, zRepartition, zTaux } from './common.js';

/** Nature comptable de la recette — détermine son poste au compte de résultat et dans les SIG. */
export const zNatureRecette = z.enum([
  'vente_marchandises',
  'production_biens',
  'prestations',
  'honoraires',
  'loyers',
  'subvention_exploitation',
  'autres_produits',
]);
export type NatureRecette = z.infer<typeof zNatureRecette>;

export const LIBELLES_NATURE_RECETTE: Record<NatureRecette, string> = {
  vente_marchandises: 'Ventes de marchandises',
  production_biens: 'Production vendue — biens',
  prestations: 'Prestations de services',
  honoraires: 'Honoraires',
  loyers: 'Loyers',
  subvention_exploitation: 'Subventions d’exploitation',
  autres_produits: 'Autres produits',
};

/** Les ventes de marchandises entrent dans la marge commerciale ; le reste, dans la production. */
export function estMarchandise(nature: NatureRecette): boolean {
  return nature === 'vente_marchandises';
}

/**
 * Mode de détermination du chiffre d'affaires d'une ligne :
 *
 * - `montants`    : un montant HT saisi par exercice
 * - `croissance`  : montant du premier exercice + taux de croissance par exercice suivant
 * - `volume_prix` : quantité × prix unitaire, par exercice
 * - `capacite`    : nombre d'unités de production × taux de remplissage × prix, par exercice
 *                   (couvre les activités de service : places, couverts, séances, tournées)
 */
export const zModeRecette = z.enum(['montants', 'croissance', 'volume_prix', 'capacite']);
export type ModeRecette = z.infer<typeof zModeRecette>;

export const zLigneRecette = zLigneBase.extend({
  nature: zNatureRecette.default('prestations'),
  mode: zModeRecette.default('montants'),

  /** Mode `montants` : chiffre d'affaires HT par exercice. */
  montants: z.array(zMontant).default([]),

  /** Mode `croissance` : base du premier exercice. */
  base: zMontant.default(0),
  /** Mode `croissance` : taux de croissance en % appliqué à l'exercice précédent (index 0 ignoré). */
  tauxCroissance: z.array(zTaux).default([]),

  /** Modes `volume_prix` et `capacite` : quantités par exercice. */
  quantites: z.array(zMontant).default([]),
  /** Modes `volume_prix` et `capacite` : prix unitaire HT par exercice. */
  prixUnitaire: z.array(zMontant).default([]),
  /** Mode `capacite` : taux de remplissage en % par exercice. */
  tauxRemplissage: z.array(zTaux).default([]),
  /** Unité affichée dans l'interface (« couverts », « séances », « heures »…). */
  unite: z.string().max(40).default(''),

  tauxTva: zTaux.default(20),
  repartition: zRepartition.default(REPARTITION_LINEAIRE),
  /**
   * Délai d'encaissement propre à cette ligne, en jours.
   * Laisser vide pour utiliser le délai client général des paramètres.
   */
  delaiEncaissementJours: z.number().min(0).max(365).optional(),
  /**
   * Coût d'achat lié, en % du chiffre d'affaires de la ligne.
   * Génère automatiquement un achat consommé (utile pour le négoce et la restauration).
   * Laisser à 0 si les achats sont saisis en propre dans la section Charges.
   */
  tauxAchatsLiesPourcent: zTaux.default(0),
});
export type LigneRecette = z.infer<typeof zLigneRecette>;

export const zSectionRecettes = z.object({
  lignes: z.array(zLigneRecette).default([]),
});
export type SectionRecettes = z.infer<typeof zSectionRecettes>;

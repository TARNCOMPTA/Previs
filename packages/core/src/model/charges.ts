import { z } from 'zod';
import {
  REPARTITION_LINEAIRE,
  zExercice,
  zLigneBase,
  zMois,
  zMontant,
  zRepartition,
  zTaux,
} from './common.js';

/**
 * Poste du compte de résultat auquel se rattache la charge.
 * L'ordre de cette énumération est celui d'affichage dans l'interface et dans le PDF.
 */
export const zCategorieCharge = z.enum([
  'achats_marchandises',
  'achats_matieres',
  'fournitures',
  'sous_traitance',
  'services_exterieurs',
  'autres_services_exterieurs',
  'impots_taxes',
  'autres_charges',
  'charges_financieres',
]);
export type CategorieCharge = z.infer<typeof zCategorieCharge>;

export const LIBELLES_CATEGORIE_CHARGE: Record<CategorieCharge, string> = {
  achats_marchandises: 'Achats de marchandises',
  achats_matieres: 'Achats de matières premières',
  fournitures: 'Fournitures et petits équipements',
  sous_traitance: 'Sous-traitance',
  services_exterieurs: 'Services extérieurs',
  autres_services_exterieurs: 'Autres services extérieurs',
  impots_taxes: 'Impôts, taxes et versements assimilés',
  autres_charges: 'Autres charges de gestion courante',
  charges_financieres: 'Charges financières diverses',
};

/** Les achats consommés entrent dans le calcul de la marge et de la variation de stock. */
export function estAchatConsomme(categorie: CategorieCharge): boolean {
  return categorie === 'achats_marchandises' || categorie === 'achats_matieres';
}

/** Une charge peut être saisie en euros ou en pourcentage du chiffre d'affaires. */
export const zModeCharge = z.enum(['montant', 'pourcentage_ca']);
export type ModeCharge = z.infer<typeof zModeCharge>;

export const zLigneCharge = zLigneBase.extend({
  categorie: zCategorieCharge.default('services_exterieurs'),
  /** Numéro de compte du plan comptable général (facultatif, 6xxxxx). */
  compte: z.string().max(10).optional(),
  mode: zModeCharge.default('montant'),
  /** Mode `montant` : charge HT par exercice. */
  montants: z.array(zMontant).default([]),
  /** Mode `pourcentage_ca` : pourcentage du chiffre d'affaires total, par exercice. */
  pourcentages: z.array(zTaux).default([]),
  tauxTva: zTaux.default(20),
  /** TVA déductible sur cette charge (faux pour les carburants non déductibles, par ex.). */
  tvaDeductible: z.boolean().default(true),
  repartition: zRepartition.default(REPARTITION_LINEAIRE),
  /**
   * Délai de règlement propre à cette ligne, en jours.
   * Laisser vide pour utiliser le délai fournisseur général des paramètres.
   */
  delaiPaiementJours: z.number().min(0).max(365).optional(),
  /** Charge fixe (structure) ou variable : détermine le calcul du seuil de rentabilité. */
  fixe: z.boolean().default(true),
});
export type LigneCharge = z.infer<typeof zLigneCharge>;

/**
 * Statut de la personne rémunérée. Détermine le traitement fiscal et social :
 *
 * - `salarie` / `dirigeant_assimile` : brut + charges patronales, tous deux déductibles
 * - `dirigeant_tns`  : rémunération déductible + cotisations TNS déductibles (gérant majoritaire)
 * - `exploitant`     : les prélèvements NE SONT PAS déductibles (BNC / BIC à l'IR) ;
 *                      seules les cotisations sociales le sont, calculées sur le résultat
 */
export const zStatutPersonnel = z.enum([
  'salarie',
  'dirigeant_assimile',
  'dirigeant_tns',
  'exploitant',
]);
export type StatutPersonnel = z.infer<typeof zStatutPersonnel>;

export const LIBELLES_STATUT_PERSONNEL: Record<StatutPersonnel, string> = {
  salarie: 'Salarié',
  dirigeant_assimile: 'Dirigeant assimilé salarié',
  dirigeant_tns: 'Dirigeant travailleur non salarié',
  exploitant: 'Exploitant / praticien (prélèvements non déductibles)',
};

export const zLignePersonnel = zLigneBase.extend({
  statut: zStatutPersonnel.default('salarie'),
  /** Effectif par exercice (peut être fractionnaire pour un temps partiel). */
  effectifs: z.array(z.number().min(0).max(999)).default([]),
  /** Salaire brut mensuel unitaire par exercice. */
  brutMensuel: z.array(zMontant).default([]),
  /** Nombre de mois rémunérés dans l'exercice (13 si treizième mois). */
  nbMoisParExercice: z.array(z.number().min(0).max(24)).default([]),
  /** Primes annuelles globales par exercice, hors brut mensuel. */
  primes: z.array(zMontant).default([]),
  /** Exercice d'entrée dans l'effectif. */
  exerciceEmbauche: zExercice.default(0),
  /** Mois d'entrée au sein de cet exercice. */
  moisEmbauche: zMois.default(1),
  /** Taux de charges patronales spécifique en %, sinon le taux général des paramètres. */
  tauxChargesPatronales: zTaux.optional(),
  /** Taux de cotisations TNS spécifique en %, sinon le taux général des paramètres. */
  tauxCotisationsTns: zTaux.optional(),
  /** Aide à l'embauche ou exonération, en déduction des charges, par exercice. */
  aides: z.array(zMontant).default([]),
});
export type LignePersonnel = z.infer<typeof zLignePersonnel>;

export const zSectionCharges = z.object({
  lignes: z.array(zLigneCharge).default([]),
  personnel: z.array(zLignePersonnel).default([]),
});
export type SectionCharges = z.infer<typeof zSectionCharges>;

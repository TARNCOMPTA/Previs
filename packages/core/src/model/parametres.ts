import { z } from 'zod';
import { zMontant, zTaux } from './common.js';

/** Périodicité de déclaration et de décaissement de la TVA. */
export const zRegimeTva = z.enum(['mensuel', 'trimestriel', 'annuel', 'franchise']);
export type RegimeTva = z.infer<typeof zRegimeTva>;

export const zParametresTva = z.object({
  assujetti: z.boolean().default(true),
  regime: zRegimeTva.default('mensuel'),
  /** Taux appliqué par défaut aux nouvelles lignes. */
  tauxParDefaut: zTaux.default(20),
  /** Décalage entre le fait générateur et le décaissement, en mois (1 = paiement le mois suivant). */
  decalageDecaissementMois: z.number().int().min(0).max(6).default(1),
  /** Crédit de TVA reporté sur les périodes suivantes plutôt que remboursé. */
  creditReportable: z.boolean().default(true),
});
export type ParametresTva = z.infer<typeof zParametresTva>;

export const zParametresIS = z.object({
  /** Taux réduit applicable à la fraction de bénéfice sous plafond (PME éligibles). */
  tauxReduit: zTaux.default(15),
  plafondTauxReduit: zMontant.default(42500),
  tauxNormal: zTaux.default(25),
  /** Décocher si la société ne remplit pas les conditions du taux réduit. */
  eligibleTauxReduit: z.boolean().default(true),
  /** Décalage de paiement du solde d'IS, en mois après la clôture. */
  decalagePaiementMois: z.number().int().min(0).max(12).default(4),
  /** Acomptes trimestriels versés au cours de l'exercice (dès le 2e exercice bénéficiaire). */
  acomptes: z.boolean().default(false),
});
export type ParametresIS = z.infer<typeof zParametresIS>;

/**
 * Cotisations du travailleur non salarié (gérant majoritaire, exploitant, libéral).
 *
 * Pour un BNC ou un BIC à l'IR, l'assiette est le résultat lui-même : le moteur résout
 * la circularité `cot = taux × (résultat avant cotisations − cot)` de façon exacte.
 */
export const zParametresTns = z.object({
  /** Taux global de cotisations sociales appliqué à l'assiette. */
  tauxCotisations: zTaux.default(45),
  /** Cotisations minimales dues même en l'absence de bénéfice. */
  cotisationsMinimales: zMontant.default(1200),
  /** Le résultat de référence est-il pris avant déduction des cotisations (BNC/BIC) ? */
  assietteResultatAvantCotisations: z.boolean().default(true),
  /** Périodicité de décaissement des cotisations. */
  periodicite: z.enum(['mensuelle', 'trimestrielle']).default('trimestrielle'),
});
export type ParametresTns = z.infer<typeof zParametresTns>;

export const zParametresIR = z.object({
  /**
   * Taux moyen d'imposition personnelle estimé, appliqué au résultat fiscal.
   * Sert uniquement à une information de synthèse : l'IR n'est pas une charge de l'entreprise.
   */
  tauxMoyen: zTaux.default(0),
  /** Si vrai, l'IR estimé est décaissé dans le plan de trésorerie (prélèvement à la source). */
  decaisse: z.boolean().default(false),
});
export type ParametresIR = z.infer<typeof zParametresIR>;

export const zParametresSocial = z.object({
  /** Taux de charges patronales appliqué au brut des salariés, en pourcentage. */
  tauxChargesPatronales: zTaux.default(42),
  /** Taux de charges salariales, utilisé pour afficher le net à payer. */
  tauxChargesSalariales: zTaux.default(22),
  /** Périodicité de décaissement des charges sociales sur salaires. */
  periodicite: z.enum(['mensuelle', 'trimestrielle']).default('mensuelle'),
  /** Décalage de paiement des charges sociales, en mois. */
  decalageMois: z.number().int().min(0).max(6).default(1),
});
export type ParametresSocial = z.infer<typeof zParametresSocial>;

/** Paramètres du besoin en fonds de roulement — pilotent aussi la trésorerie mensuelle. */
export const zParametresBfr = z.object({
  /** Délai moyen d'encaissement des clients, en jours. 0 = encaissement comptant. */
  delaiClientsJours: z.number().min(0).max(365).default(0),
  /** Délai moyen de règlement des fournisseurs, en jours. */
  delaiFournisseursJours: z.number().min(0).max(365).default(0),
  /** Rotation du stock, en jours d'achats. 0 = pas de stock. */
  rotationStockJours: z.number().min(0).max(365).default(0),
  /** Part du chiffre d'affaires encaissée comptant, en pourcentage (le reste suit le délai client). */
  partComptantPourcent: zTaux.default(0),
});
export type ParametresBfr = z.infer<typeof zParametresBfr>;

/**
 * Paramètres généraux du dossier : période couverte, fiscalité, social, BFR.
 * C'est la section « Autres » de l'interface, onglet « Hypothèses ».
 */
export const zParametres = z.object({
  /** Premier jour du premier exercice, au format ISO `AAAA-MM-JJ`. */
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-01-01'),
  /** Nombre d'exercices projetés (3 par défaut, jusqu'à 10 pour un plan de continuation). */
  nbExercices: z.number().int().min(1).max(10).default(3),
  /** Durée du premier exercice en mois (12 par défaut, jusqu'à 24 pour un exercice long). */
  dureePremierExerciceMois: z.number().int().min(1).max(24).default(12),

  tva: zParametresTva.default({}),
  is: zParametresIS.default({}),
  tns: zParametresTns.default({}),
  ir: zParametresIR.default({}),
  social: zParametresSocial.default({}),
  bfr: zParametresBfr.default({}),

  /** Cotisation foncière des entreprises estimée, un montant par exercice. */
  cfe: z.array(zMontant).default([]),
  /** Trésorerie disponible au premier jour du prévisionnel (reprise, apport déjà versé…). */
  tresorerieInitiale: zMontant.default(0),
  /** Dotation à la réserve légale, en pourcentage du bénéfice (sociétés uniquement). */
  reserveLegalePourcent: zTaux.default(5),
  /** Plafond de la réserve légale, en pourcentage du capital social. */
  plafondReserveLegalePourcent: zTaux.default(10),
  /** Taux d'intérêt servi sur les comptes courants d'associés, en pourcentage annuel. */
  tauxInteretCompteCourant: zTaux.default(0),
});
export type Parametres = z.infer<typeof zParametres>;

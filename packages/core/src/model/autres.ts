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

/** Produit ou charge exceptionnel, hors exploitation courante. */
export const zLigneExceptionnelle = zLigneBase.extend({
  sens: z.enum(['produit', 'charge']).default('produit'),
  montants: z.array(zMontant).default([]),
  repartition: zRepartition.default(REPARTITION_LINEAIRE),
  tauxTva: zTaux.default(0),
  /** Faux pour une écriture sans flux (reprise de provision, par exemple). */
  impacteTresorerie: z.boolean().default(true),
});
export type LigneExceptionnelle = z.infer<typeof zLigneExceptionnelle>;

/**
 * Distribution de résultat aux associés ou à l'exploitant.
 *
 * - `dividendes` : prélevés sur le résultat distribuable de l'exercice précédent (sociétés)
 * - `prelevements_exploitant` : retraits personnels non déductibles (BNC / BIC à l'IR)
 */
export const zTypeDistribution = z.enum(['dividendes', 'prelevements_exploitant']);
export type TypeDistribution = z.infer<typeof zTypeDistribution>;

export const zLigneDistribution = zLigneBase.extend({
  type: zTypeDistribution.default('dividendes'),
  /** Montant distribué, par exercice de versement. */
  montants: z.array(zMontant).default([]),
  repartition: zRepartition.default(REPARTITION_LINEAIRE),
});
export type LigneDistribution = z.infer<typeof zLigneDistribution>;

/** Une échéance de remboursement du passif déclaré, pour un plan de continuation. */
export const zEcheancePassif = z.object({
  exercice: zExercice,
  mois: zMois.default(12),
  montant: zMontant.default(0),
});
export type EcheancePassif = z.infer<typeof zEcheancePassif>;

/** Créance déclarée dans le cadre d'un redressement judiciaire, et son échéancier. */
export const zLignePassifDeclare = zLigneBase.extend({
  creancier: z.string().max(150).default(''),
  nature: z.enum(['privilegie', 'chirographaire', 'fiscal_social', 'bancaire']).default('chirographaire'),
  montantDeclare: zMontant.default(0),
  echeances: z.array(zEcheancePassif).default([]),
});
export type LignePassifDeclare = z.infer<typeof zLignePassifDeclare>;

/**
 * Élément de bilan repris au démarrage : uniquement pour une reprise, un plan de
 * continuation ou un prévisionnel de développement adossé à une situation existante.
 */
export const zBilanOuverture = z.object({
  actif: z.boolean().default(false),
  immobilisationsBrutes: zMontant.default(0),
  amortissementsCumules: zMontant.default(0),
  stocks: zMontant.default(0),
  creancesClients: zMontant.default(0),
  autresCreances: zMontant.default(0),
  capitalSocial: zMontant.default(0),
  reserves: zMontant.default(0),
  reportANouveau: zMontant.default(0),
  comptesCourants: zMontant.default(0),
  empruntsRestantDus: zMontant.default(0),
  dettesFournisseurs: zMontant.default(0),
  dettesFiscalesSociales: zMontant.default(0),
});
export type BilanOuverture = z.infer<typeof zBilanOuverture>;

export const zSectionAutres = z.object({
  exceptionnels: z.array(zLigneExceptionnelle).default([]),
  distributions: z.array(zLigneDistribution).default([]),
  passifDeclare: z.array(zLignePassifDeclare).default([]),
  bilanOuverture: zBilanOuverture.default({}),
  /** Notes libres du dossier, reprises en fin de PDF. */
  notes: z.string().max(20000).default(''),
});
export type SectionAutres = z.infer<typeof zSectionAutres>;

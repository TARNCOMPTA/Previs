import { z } from 'zod';
import { zExercice, zLigneBase, zMois, zMontant, zTaux } from './common.js';

export const zTypeApport = z.enum([
  'capital',
  'capital_nature',
  'compte_courant',
  'apport_personnel',
  'prime_emission',
]);
export type TypeApport = z.infer<typeof zTypeApport>;

export const LIBELLES_TYPE_APPORT: Record<TypeApport, string> = {
  capital: 'Capital social (numéraire)',
  capital_nature: 'Apport en nature',
  compte_courant: 'Compte courant d’associé',
  apport_personnel: 'Apport personnel de l’exploitant',
  prime_emission: 'Prime d’émission',
};

export const zApport = zLigneBase.extend({
  type: zTypeApport.default('capital'),
  /** Nom de l'apporteur, repris dans le tableau de financement. */
  apporteur: z.string().max(150).default(''),
  montant: zMontant.default(0),
  exercice: zExercice.default(0),
  mois: zMois.default(1),
  /** Remboursements du compte courant, un montant par exercice (positif = remboursé). */
  remboursements: z.array(zMontant).default([]),
});
export type Apport = z.infer<typeof zApport>;

export const zPeriodiciteEmprunt = z.enum(['mensuelle', 'trimestrielle', 'annuelle']);
export type PeriodiciteEmprunt = z.infer<typeof zPeriodiciteEmprunt>;

export const zTypeDiffere = z.enum(['aucun', 'partiel', 'total']);
export type TypeDiffere = z.infer<typeof zTypeDiffere>;

/**
 * Un emprunt bancaire à échéances constantes.
 *
 * - `differe partiel` : seuls les intérêts sont réglés pendant la franchise.
 * - `differe total`   : rien n'est réglé, les intérêts sont capitalisés.
 * L'assurance est calculée sur le capital initial (usage bancaire le plus courant)
 * ou sur le capital restant dû selon `assuranceSurCapitalRestant`.
 */
export const zEmprunt = zLigneBase.extend({
  organisme: z.string().max(150).default(''),
  montant: zMontant.default(0),
  /** Taux nominal annuel, hors assurance, en pourcentage. */
  tauxAnnuel: zTaux.default(3.5),
  dureeMois: z.number().int().min(1).max(360).default(84),
  exerciceDeblocage: zExercice.default(0),
  moisDeblocage: zMois.default(1),
  periodicite: zPeriodiciteEmprunt.default('mensuelle'),
  typeDiffere: zTypeDiffere.default('aucun'),
  /** Durée de la franchise en mois, comptée à partir du déblocage. */
  differeMois: z.number().int().min(0).max(60).default(0),
  /** Taux annuel d'assurance emprunteur, en pourcentage. */
  tauxAssuranceAnnuel: zTaux.default(0),
  assuranceSurCapitalRestant: z.boolean().default(false),
  /** Frais de dossier réglés au déblocage. */
  fraisDossier: zMontant.default(0),
  /** Garantie (caution BPI, nantissement…) réglée au déblocage. */
  fraisGarantie: zMontant.default(0),
});
export type Emprunt = z.infer<typeof zEmprunt>;

export const zTypeSubvention = z.enum(['investissement', 'exploitation']);
export type TypeSubvention = z.infer<typeof zTypeSubvention>;

export const zSubvention = zLigneBase.extend({
  organisme: z.string().max(150).default(''),
  type: zTypeSubvention.default('investissement'),
  montant: zMontant.default(0),
  exercice: zExercice.default(0),
  mois: zMois.default(1),
  /**
   * Nombre d'années de reprise au compte de résultat pour une subvention d'investissement.
   * 0 = comptabilisée intégralement en produit sur l'exercice d'encaissement.
   */
  repriseSurAnnees: z.number().int().min(0).max(20).default(0),
});
export type Subvention = z.infer<typeof zSubvention>;

/** Crédit-bail ou location financière : loyer en charge, pas d'immobilisation à l'actif. */
export const zCreditBail = zLigneBase.extend({
  organisme: z.string().max(150).default(''),
  /** Valeur du bien financé, pour information dans le tableau de financement. */
  valeurBien: zMontant.default(0),
  loyerMensuelHT: zMontant.default(0),
  dureeMois: z.number().int().min(1).max(240).default(48),
  exerciceDebut: zExercice.default(0),
  moisDebut: zMois.default(1),
  /** Dépôt de garantie versé au démarrage, restitué en fin de contrat. */
  depotGarantie: zMontant.default(0),
  /** Option d'achat en fin de contrat. */
  valeurResiduelle: zMontant.default(0),
  tauxTva: zTaux.default(20),
});
export type CreditBail = z.infer<typeof zCreditBail>;

export const zSectionFinancements = z.object({
  apports: z.array(zApport).default([]),
  emprunts: z.array(zEmprunt).default([]),
  subventions: z.array(zSubvention).default([]),
  creditsBaux: z.array(zCreditBail).default([]),
});
export type SectionFinancements = z.infer<typeof zSectionFinancements>;

import { z } from 'zod';

/** Régime fiscal du dossier — pilote l'ensemble du moteur de calcul. */
export const zRegimeFiscal = z.enum([
  /** Société soumise à l'impôt sur les sociétés (SAS, SASU, SARL, EURL à l'IS…). */
  'IS',
  /** Bénéfices non commerciaux au réel : profession libérale (infirmier, médecin, kiné…). */
  'BNC',
  /** Bénéfices industriels et commerciaux au réel : entreprise individuelle, commerçant, artisan. */
  'BIC_IR',
]);
export type RegimeFiscal = z.infer<typeof zRegimeFiscal>;

export const LIBELLES_REGIME: Record<RegimeFiscal, string> = {
  IS: 'Société à l’impôt sur les sociétés',
  BNC: 'Profession libérale (BNC au réel)',
  BIC_IR: 'Entreprise individuelle (BIC au réel, IR)',
};

/** Un dossier à l'IS tient un bilan complet ; un BNC tient une comptabilité de trésorerie. */
export function estSocieteIS(regime: RegimeFiscal): boolean {
  return regime === 'IS';
}

export const zTypeDossier = z.enum([
  'creation',
  'reprise',
  'developpement',
  'financement',
  'plan_continuation',
]);
export type TypeDossier = z.infer<typeof zTypeDossier>;

export const LIBELLES_TYPE_DOSSIER: Record<TypeDossier, string> = {
  creation: 'Création d’entreprise',
  reprise: 'Reprise / cession',
  developpement: 'Développement',
  financement: 'Demande de financement',
  plan_continuation: 'Plan de continuation (RJ)',
};

export const zDirigeant = z.object({
  id: z.string().min(1),
  nom: z.string().min(1).max(150),
  fonction: z.string().max(120).default('Gérant'),
  /** Pourcentage de détention du capital. */
  partCapital: z.number().min(0).max(100).default(0),
});
export type Dirigeant = z.infer<typeof zDirigeant>;

export const zAdresse = z.object({
  voie: z.string().max(200).default(''),
  complement: z.string().max(200).default(''),
  codePostal: z.string().max(10).default(''),
  ville: z.string().max(120).default(''),
});
export type Adresse = z.infer<typeof zAdresse>;

/**
 * Identité du dossier et texte d'introduction du rapport.
 * Alimente la page de garde et la section « Introduction » du PDF.
 */
export const zIdentite = z.object({
  raisonSociale: z.string().max(200).default(''),
  formeJuridique: z.string().max(80).default(''),
  regime: zRegimeFiscal.default('IS'),
  typeDossier: zTypeDossier.default('creation'),
  activite: z.string().max(300).default(''),
  codeNaf: z.string().max(10).default(''),
  siret: z.string().max(20).default(''),
  adresse: zAdresse.default({ voie: '', complement: '', codePostal: '', ville: '' }),
  email: z.string().max(150).default(''),
  telephone: z.string().max(30).default(''),
  dirigeants: z.array(zDirigeant).default([]),
  /**
   * Introduction rédigée (4 à 6 paragraphes) reprise telle quelle dans le PDF.
   * Séparer les paragraphes par une ligne vide.
   */
  introduction: z.string().max(20000).default(''),
  /** Section « Rappel de la procédure », uniquement pour un plan de continuation. */
  rappelProcedure: z.string().max(20000).default(''),
});
export type Identite = z.infer<typeof zIdentite>;

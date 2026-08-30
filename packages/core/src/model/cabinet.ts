import { z } from 'zod';
import { zAdresse } from './identite.js';

/**
 * Formats d'image acceptés pour un logo.
 *
 * Le SVG est volontairement exclu : c'est un document XML qui peut porter du script
 * et référencer des ressources distantes. Le PDF l'imprimerait dans un Chromium
 * certes privé de JavaScript, mais l'interface, elle, l'afficherait tel quel.
 */
export const TYPES_LOGO = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type TypeLogo = (typeof TYPES_LOGO)[number];

/** Taille maximale d'un logo encodé en base64, soit environ 512 Ko d'image. */
export const LOGO_MAX_CARACTERES = 700_000;

const MOTIF_LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/**
 * Un logo, transporté en URI de données.
 *
 * L'image voyage avec le dossier plutôt que par une URL : le PDF est produit dans un
 * Chromium coupé du réseau, et la politique de contenu de l'interface n'autorise
 * aucune image distante.
 */
export const zLogo = z
  .string()
  .max(LOGO_MAX_CARACTERES)
  .regex(MOTIF_LOGO, 'Le logo doit être une image PNG, JPEG ou WebP encodée en base64.');

/** Un logo facultatif : chaîne vide quand aucun n'est déposé. */
export const zLogoFacultatif = z.union([z.literal(''), zLogo]).default('');

/**
 * Identité du cabinet, commune à tous les dossiers.
 *
 * Elle alimente la page de garde, les bandeaux de chaque page et le pied du PDF.
 * Elle est modifiable depuis l'écran Administration : rien n'est figé dans le code,
 * le logiciel peut donc servir un autre cabinet sans recompilation.
 */
export const zCabinet = z.object({
  nom: z.string().max(200).default('TARN COMPTA'),
  formeJuridique: z.string().max(80).default(''),
  /** Mention portée sous le nom : « Cabinet d'expertise comptable », par exemple. */
  qualite: z.string().max(150).default('Cabinet d’expertise comptable'),
  /** Expert-comptable signataire des dossiers. */
  expertComptable: z.string().max(150).default(''),
  /**
   * Inscription au tableau de l'Ordre des experts-comptables.
   * Mention obligatoire sur les documents professionnels du cabinet.
   */
  inscriptionOrdre: z.string().max(200).default(''),
  siret: z.string().max(20).default(''),
  numeroTva: z.string().max(20).default(''),
  capital: z.string().max(60).default(''),
  adresse: zAdresse.default({ voie: '', complement: '', codePostal: '', ville: '' }),
  telephone: z.string().max(30).default(''),
  courriel: z.string().max(150).default(''),
  site: z.string().max(150).default(''),
  logo: zLogoFacultatif,
  /** Avertissement reproduit en fin de dossier, sous les coordonnées. */
  mentionLegale: z
    .string()
    .max(2000)
    .default(
      'Le présent dossier prévisionnel a été établi à partir des hypothèses communiquées par le client. ' +
        'Ces projections sont estimatives et reposent sur des hypothèses raisonnables à la date de leur ' +
        'établissement ; elles ne constituent ni une garantie de résultat, ni un engagement du cabinet.',
    ),
});
export type Cabinet = z.infer<typeof zCabinet>;

/** Identité par défaut, appliquée au premier démarrage : celle du cabinet TARN COMPTA. */
export const CABINET_PAR_DEFAUT: Cabinet = zCabinet.parse({
  nom: 'TARN COMPTA',
  qualite: 'Cabinet d’expertise comptable',
  expertComptable: 'Aymeric HANGARD',
  adresse: { voie: '70 Chemin de Mézard', complement: '', codePostal: '81000', ville: 'ALBI' },
  telephone: '05.31.51.15.51',
  courriel: 'contact@tarncompta.fr',
  site: 'www.tarncompta.com',
});

/** Adresse du cabinet sur une ligne, pour un bandeau ou un pied de page. */
export function adresseSurUneLigne(cabinet: Cabinet): string {
  const { voie, complement, codePostal, ville } = cabinet.adresse;
  return [voie, complement, [codePostal, ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

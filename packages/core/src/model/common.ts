import { z } from 'zod';

/** Identifiant stable d'une ligne. Généré côté client ou côté LLM. */
export const zId = z.string().min(1).max(64);

/** Montant en euros. Toujours stocké en euros (décimales autorisées à la saisie). */
export const zMontant = z.number().finite();

/** Taux exprimé en pourcentage : 20 signifie 20 %. */
export const zTaux = z.number().finite().min(-100).max(1000);

/** Nombre de mois (1 = premier mois de l'exercice concerné). */
export const zMois = z.number().int().min(1).max(24);

/** Index d'exercice, 0 = premier exercice du prévisionnel. */
export const zExercice = z.number().int().min(0).max(19);

/**
 * Clé de répartition d'un montant annuel sur les mois de l'exercice.
 *
 * - `lineaire`      : 1/n sur chaque mois de l'exercice
 * - `ponctuel`      : la totalité sur un mois donné
 * - `demarrage`     : réparti linéairement à partir du mois `moisDebut` jusqu'à la clôture
 * - `saisonnalite`  : réparti au prorata de poids relatifs (un poids par mois de l'exercice)
 * - `mensuel`       : montants mensuels saisis explicitement, `montants[exercice][mois]`.
 *                     Ces montants priment alors sur le montant annuel de la ligne.
 */
export const zRepartition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lineaire') }),
  z.object({ type: z.literal('ponctuel'), mois: zMois }),
  z.object({ type: z.literal('demarrage'), moisDebut: zMois }),
  z.object({ type: z.literal('saisonnalite'), poids: z.array(z.number().min(0)).min(1).max(24) }),
  z.object({ type: z.literal('mensuel'), montants: z.array(z.array(zMontant)) }),
]);
export type Repartition = z.infer<typeof zRepartition>;

export const REPARTITION_LINEAIRE: Repartition = { type: 'lineaire' };

/** Libellés lisibles des clés de répartition, pour l'interface. */
export const LIBELLES_REPARTITION: Record<Repartition['type'], string> = {
  lineaire: 'Linéaire (1/12 par mois)',
  ponctuel: 'Ponctuel (un seul mois)',
  demarrage: 'À partir d’un mois donné',
  saisonnalite: 'Saisonnalité personnalisée',
  mensuel: 'Saisie mensuelle détaillée',
};

/**
 * Un montant par exercice. La longueur du tableau doit valoir `parametres.nbExercices` ;
 * les valeurs manquantes sont traitées comme 0 par le moteur (jamais une erreur bloquante,
 * pour que le LLM puisse remplir un dossier progressivement).
 */
export const zMontantsParExercice = z.array(zMontant);
export type MontantsParExercice = number[];

/** Taux de TVA usuels en France métropolitaine. */
export const TAUX_TVA = [0, 2.1, 5.5, 10, 20] as const;

/** Métadonnée d'origine d'une ligne : saisie humaine ou proposée par le LLM. */
export const zOrigine = z.enum(['manuel', 'llm', 'import']);
export type Origine = z.infer<typeof zOrigine>;

/** Champs communs à toutes les lignes du dossier. */
export const zLigneBase = z.object({
  id: zId,
  libelle: z.string().min(1).max(200),
  /** Commentaire libre affiché en info-bulle dans l'interface et repris en annexe du PDF. */
  note: z.string().max(2000).optional(),
  /** Renseigné automatiquement quand la ligne vient du LLM : sert au surlignage « proposé ». */
  origine: zOrigine.default('manuel'),
  /** Une ligne désactivée reste visible dans l'interface mais sort de tous les calculs. */
  actif: z.boolean().default(true),
});

/** Génère un identifiant de ligne unique, utilisable dans le navigateur comme dans Node. */
export function nouvelId(prefixe = 'l'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return `${prefixe}_${uuid.slice(0, 8)}`;
  return `${prefixe}_${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')}`;
}

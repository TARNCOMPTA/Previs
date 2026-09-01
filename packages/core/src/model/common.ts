import { z } from 'zod';

/**
 * Bornes de taille du modèle.
 *
 * Un dossier arrive par le réseau : sans plafond, une requête forgée pourrait
 * demander le calcul de centaines de milliers de lignes et immobiliser le serveur.
 * Ces valeurs sont très au-delà de ce qu'un dossier réel contient.
 */
export const EXERCICES_MAX = 20;
export const MOIS_MAX = 24;
export const LIGNES_MAX = 500;

/**
 * Ampleur totale d'un dossier, tous chemins confondus.
 *
 * `LIGNES_MAX` est posé par liste, et il y a douze listes adressables : à lui seul, il
 * laissait passer un dossier de vingt mégaoctets — mesuré, construit par l'API en
 * cinquante-cinq requêtes toutes acceptées, chacune respectant chaque plafond documenté.
 * Le relire coûtait alors 688 ms, le modifier d'une opération triviale 1 269 ms, et le
 * serveur étant mono-fil, dix requêtes concurrentes immobilisaient la connexion elle-même.
 * L'historique en gardait cent copies, soit deux gigaoctets pour un dossier.
 *
 * Les deux plafonds ci-dessous portent sur le dossier entier. Ils sont larges : un dossier
 * réel de cabinet pèse 19 Ko à soixante lignes, et 176 Ko dans le cas extrême de cinq cents
 * lignes sur dix exercices — le dossier modèle, lui, fait 8 257 octets. Ce qu'ils arrêtent
 * est le dossier qui n'en est plus un.
 */
export const LIGNES_TOTAL_MAX = 2000;

/**
 * Taille du dossier sérialisé, en OCTETS UTF-8. Huit fois le plus gros dossier plausible.
 *
 * En octets, et non en unités de code UTF-16 : `JSON.stringify(d).length` comptait ces
 * dernières, si bien qu'un dossier de « € » — un caractère, trois octets — passait à trois
 * fois le plafond. Mesuré : 1 232 027 unités de code acceptées pour 3 432 049 octets réels.
 */
export const TAILLE_DOSSIER_MAX = 1_500_000;

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
  z.object({ type: z.literal('saisonnalite'), poids: z.array(z.number().min(0)).min(1).max(MOIS_MAX) }),
  z.object({
    type: z.literal('mensuel'),
    montants: z.array(z.array(zMontant).max(MOIS_MAX)).max(EXERCICES_MAX),
  }),
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
export const zMontantsParExercice = z.array(zMontant).max(EXERCICES_MAX);
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

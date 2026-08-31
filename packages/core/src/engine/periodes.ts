import type { Parametres } from '../model/parametres.js';
import type { Exercice } from './types.js';

const MOIS_COURTS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

/** Décompose une date ISO `AAAA-MM-JJ` sans dépendre du fuseau horaire. */
function parseIso(iso: string): { annee: number; mois: number; jour: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { annee: 2026, mois: 1, jour: 1 };
  return { annee: Number(m[1]), mois: Number(m[2]), jour: Number(m[3]) };
}

function formatIso(annee: number, mois: number, jour: number): string {
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** Nombre de jours dans un mois donné (grégorien). */
function joursDansMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/** Ajoute `n` mois à un couple (année, mois) — mois est 1-based. */
function ajouterMois(annee: number, mois: number, n: number): { annee: number; mois: number } {
  const total = (annee * 12 + (mois - 1)) + n;
  return { annee: Math.floor(total / 12), mois: (total % 12) + 1 };
}

/**
 * Construit la liste des exercices du prévisionnel.
 *
 * Le premier exercice peut durer de 1 à 24 mois (exercice décalé ou premier exercice long) ;
 * les suivants durent toujours 12 mois. Le libellé porte l'année civile pour un exercice
 * aligné sur le calendrier, et « AAAA-AAAA » sinon — comme dans les dossiers TARN COMPTA.
 */
export function construireExercices(parametres: Parametres): Exercice[] {
  const { annee, mois } = parseIso(parametres.dateDebut);
  const exercices: Exercice[] = [];
  let curseurAnnee = annee;
  let curseurMois = mois;
  let moisDebutAbsolu = 0;

  for (let i = 0; i < parametres.nbExercices; i++) {
    const nbMois = i === 0 ? parametres.dureePremierExerciceMois : 12;
    const fin = ajouterMois(curseurAnnee, curseurMois, nbMois - 1);
    const dernierJour = joursDansMois(fin.annee, fin.mois);

    const alignementCivil = curseurMois === 1 && nbMois === 12;
    const libelle = alignementCivil
      ? String(curseurAnnee)
      : fin.annee === curseurAnnee
        ? String(curseurAnnee)
        : `${curseurAnnee}-${fin.annee}`;

    exercices.push({
      index: i,
      libelle,
      moisDebutAbsolu,
      nbMois,
      dateDebut: formatIso(curseurAnnee, curseurMois, 1),
      dateFin: formatIso(fin.annee, fin.mois, dernierJour),
    });

    moisDebutAbsolu += nbMois;
    const suivant = ajouterMois(curseurAnnee, curseurMois, nbMois);
    curseurAnnee = suivant.annee;
    curseurMois = suivant.mois;
  }

  return exercices;
}

/** Nombre total de mois couverts par le prévisionnel. */
export function nbMoisTotal(exercices: readonly Exercice[]): number {
  return exercices.reduce((t, e) => t + e.nbMois, 0);
}

/** Libellé court de chaque mois absolu : « janv. 2026 ». */
export function libellesMois(parametres: Parametres, exercices: readonly Exercice[]): string[] {
  const { annee, mois } = parseIso(parametres.dateDebut);
  const total = nbMoisTotal(exercices);
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const d = ajouterMois(annee, mois, i);
    out.push(`${MOIS_COURTS[d.mois - 1]} ${d.annee}`);
  }
  return out;
}

/**
 * Convertit un couple (exercice, mois dans l'exercice, 1-based) en index de mois absolu.
 *
 * L'index d'exercice est **ramené** dans l'horizon. Cette tolérance est un piège quand la
 * ligne, elle, alimente aussi un tableau indexé par exercice : le flux part sur le dernier
 * exercice tandis que l'écriture comptable est perdue, et le bilan se déséquilibre du montant
 * exact. Pour tout ce qui a une contrepartie par exercice, employer « moisAbsoluDansHorizon »,
 * qui rend « null » plutôt que de déplacer la ligne.
 */
export function moisAbsolu(exercices: readonly Exercice[], exercice: number, mois: number): number {
  const e = exercices[Math.max(0, Math.min(exercice, exercices.length - 1))];
  if (!e) return 0;
  const dans = Math.max(1, Math.min(mois, e.nbMois));
  return e.moisDebutAbsolu + (dans - 1);
}

/**
 * Comme « moisAbsolu », mais rend « null » si l'exercice visé n'existe pas.
 *
 * C'est la forme à employer partout : une ligne datée d'un exercice au-delà de l'horizon du
 * dossier — le cas d'un utilisateur qui réduit le nombre d'exercices — ne doit alors produire
 * NI flux NI écriture. Un « null » que le compilateur oblige à traiter valait mieux qu'un
 * index silencieusement déplacé : c'est cette tolérance qui déséquilibrait le bilan.
 *
 * Le mois dans l'exercice, lui, reste borné : un mois 14 d'un exercice de douze est une
 * saisie à corriger, pas une ligne à faire disparaître, et le contrôle de cohérence
 * « lignes_hors_horizon » ne s'occupe que de l'exercice.
 */
export function moisAbsoluDansHorizon(
  exercices: readonly Exercice[],
  exercice: number,
  mois: number,
): number | null {
  if (!Number.isInteger(exercice) || exercice < 0 || exercice >= exercices.length) return null;
  const e = exercices[exercice];
  if (!e) return null;
  const dans = Math.max(1, Math.min(mois, e.nbMois));
  return e.moisDebutAbsolu + (dans - 1);
}

/** Vrai si l'exercice visé existe dans le dossier. */
export function dansHorizon(exercices: readonly Exercice[], exercice: number): boolean {
  return Number.isInteger(exercice) && exercice >= 0 && exercice < exercices.length;
}

/** Exercice auquel appartient un mois absolu. Renvoie -1 au-delà de l'horizon. */
export function exercicePourMois(exercices: readonly Exercice[], moisAbs: number): number {
  for (const e of exercices) {
    if (moisAbs >= e.moisDebutAbsolu && moisAbs < e.moisDebutAbsolu + e.nbMois) return e.index;
  }
  return -1;
}

/**
 * Agrège une série mensuelle par exercice.
 * Les mois postérieurs au dernier exercice sont ignorés.
 */
export function agregerParExercice(
  serie: readonly number[],
  exercices: readonly Exercice[],
): number[] {
  return exercices.map((e) => {
    let t = 0;
    for (let m = e.moisDebutAbsolu; m < e.moisDebutAbsolu + e.nbMois; m++) t += serie[m] ?? 0;
    return t;
  });
}

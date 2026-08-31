import type { Repartition } from '../model/common.js';
import type { Exercice } from './types.js';
import { nbMoisTotal } from './periodes.js';
import { euro, repartirEgal, repartirProrata, zeros } from './utils.js';

/**
 * Répartit un montant annuel sur les mois d'un exercice selon la clé choisie.
 * Renvoie un tableau de longueur `exercice.nbMois`.
 */
export function repartirSurExercice(
  montant: number,
  repartition: Repartition,
  exercice: Exercice,
): number[] {
  const n = exercice.nbMois;
  if (n <= 0) return [];

  switch (repartition.type) {
    case 'lineaire':
      return repartirEgal(montant, n);

    case 'ponctuel': {
      const t = zeros(n);
      const i = Math.max(0, Math.min(repartition.mois - 1, n - 1));
      t[i] = euro(montant);
      return t;
    }

    case 'demarrage': {
      const debut = Math.max(0, Math.min(repartition.moisDebut - 1, n - 1));
      const t = zeros(n);
      const parts = repartirEgal(montant, n - debut);
      for (let i = 0; i < parts.length; i++) t[debut + i] = parts[i];
      return t;
    }

    case 'saisonnalite': {
      // Les poids sont recyclés si l'exercice est plus long que la saisonnalité fournie.
      const poids = Array.from({ length: n }, (_, i) => {
        const p = repartition.poids[i % repartition.poids.length];
        return Number.isFinite(p) && p > 0 ? p : 0;
      });
      return repartirProrata(montant, poids);
    }

    case 'mensuel': {
      const ligne = repartition.montants[exercice.index];
      // Aucune grille mensuelle pour cet exercice : le montant annuel saisi est la seule
      // information dont on dispose, et il se répartit comme une ligne ordinaire. Voir
      // `totauxAnnuelsDepuisRepartition` pour le pourquoi.
      if (!ligne || ligne.length === 0) return repartirEgal(montant, n);
      return Array.from({ length: n }, (_, i) => euro(ligne[i] ?? 0));
    }
  }
}

/**
 * Répartit un montant par exercice sur l'ensemble du calendrier du prévisionnel.
 * Renvoie une série mensuelle de longueur `nbMoisTotal(exercices)`.
 */
export function repartirSurCalendrier(
  montantsParExercice: readonly number[],
  repartition: Repartition,
  exercices: readonly Exercice[],
): number[] {
  const serie = zeros(nbMoisTotal(exercices));
  for (const e of exercices) {
    const montant = montantsParExercice[e.index] ?? 0;
    if (repartition.type !== 'mensuel' && montant === 0) continue;
    const parts = repartirSurExercice(montant, repartition, e);
    for (let i = 0; i < parts.length; i++) serie[e.moisDebutAbsolu + i] = parts[i];
  }
  return serie;
}

/**
 * Quand la répartition est `mensuel`, les montants mensuels saisis priment sur les
 * montants annuels : cette fonction recalcule les totaux annuels correspondants.
 *
 * Mais seulement là où une grille mensuelle EXISTE. Un exercice sans grille reprend le
 * montant annuel, et ce détail-ci est un chiffre client :
 *
 * `ajusterSeries()` complète les tableaux « par exercice » quand le prévisionnel s'allonge,
 * mais il ne touche pas la matrice d'une répartition mensuelle — trois lignes restent trois
 * lignes. Sans la reprise ci-dessous, une charge portée de trois à cinq exercices rendait
 * ZÉRO sur les deux nouveaux, quel que soit le montant annuel saisi dans la grille. La
 * charge disparaissait du compte de résultat, de la trésorerie, du bilan et du PDF remis au
 * banquier — et l'écart de bilan restait nul, zéro étant parfaitement cohérent. Un chiffre
 * qui s'évapore vaut un chiffre inventé.
 *
 * Une ligne PRÉSENTE mais toute à zéro reste un zéro voulu : c'est une saisie, pas une
 * absence.
 */
export function totauxAnnuelsDepuisRepartition(
  montantsParExercice: readonly number[],
  repartition: Repartition,
  exercices: readonly Exercice[],
): number[] {
  if (repartition.type !== 'mensuel') {
    return exercices.map((e) => montantsParExercice[e.index] ?? 0);
  }
  return exercices.map((e) => {
    const ligne = repartition.montants[e.index];
    if (!ligne || ligne.length === 0) return montantsParExercice[e.index] ?? 0;
    let t = 0;
    for (let i = 0; i < e.nbMois; i++) t += ligne[i] ?? 0;
    return euro(t);
  });
}

/**
 * Décale une série mensuelle d'un délai exprimé en jours (30 jours = 1 mois).
 *
 * Le décalage fractionnaire est réparti linéairement entre les deux mois encadrants :
 * un délai de 45 jours place 50 % du flux à M+1 et 50 % à M+2. C'est ce qui permet à la
 * trésorerie de refléter fidèlement des délais clients qui ne sont pas des multiples de 30.
 *
 * `horizon` fixe la longueur de la série renvoyée ; les flux qui débordent sont perdus
 * pour la trésorerie mais restent au bilan sous forme de créances ou de dettes.
 */
export function decalerSerie(serie: readonly number[], delaiJours: number, horizon: number): number[] {
  const out = zeros(horizon);
  const delai = Math.max(0, delaiJours) / 30;
  const entier = Math.floor(delai);
  const reste = delai - entier;

  for (let m = 0; m < serie.length; m++) {
    const v = serie[m];
    if (!v) continue;
    const cible1 = m + entier;
    const cible2 = cible1 + 1;
    if (cible1 < horizon) out[cible1] += v * (1 - reste);
    if (reste > 0 && cible2 < horizon) out[cible2] += v * reste;
  }
  return out.map(euro);
}

/**
 * Part d'un flux qui reste à encaisser ou à décaisser à la clôture, pour un délai donné.
 * C'est la base du calcul des créances clients et des dettes fournisseurs au bilan.
 */
export function encoursFinExercice(
  serie: readonly number[],
  delaiJours: number,
  exercice: Exercice,
): number {
  const delai = Math.max(0, delaiJours) / 30;
  const fin = exercice.moisDebutAbsolu + exercice.nbMois;
  let encours = 0;
  // Chaque mois du prévisionnel contribue à hauteur de la part non encore réglée à la clôture.
  for (let m = 0; m < fin; m++) {
    const v = serie[m] ?? 0;
    if (!v) continue;
    const moisRestants = delai - (fin - 1 - m);
    if (moisRestants <= 0) continue;
    encours += v * Math.min(1, moisRestants);
  }
  return euro(encours);
}

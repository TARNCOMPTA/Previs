import { repartirSurExercice, type Exercice, type Repartition } from '@previs/core';

/**
 * La matrice mensuelle après la saisie d'UNE cellule.
 *
 * Hors du composant, et pure, parce que c'est ici que se jouait une perte de chiffre. Le
 * moteur, devant une ligne de matrice absente, répartit le total annuel en parts égales sur
 * les mois de l'exercice. Écrire la seule cellule touchée rendait donc la ligne
 * « présente », et les onze autres mois valaient zéro pour de bon : un total de 13 000 €
 * retombait à 500 € au moment même où l'on venait le vérifier.
 *
 * La ligne éditée est donc écrite ENTIÈRE, à partir des montants en vigueur — ceux que le
 * moteur emploie, obtenus de lui. Les autres exercices sont recopiés tels quels : un
 * exercice sans ligne propre doit RESTER sans ligne propre, sinon la même saisie fige au
 * passage des exercices que l'utilisateur n'a pas touchés.
 */
export function matriceApresSaisie(
  exercices: readonly Exercice[],
  repartition: Repartition,
  montantsAnnuels: readonly number[],
  cible: Exercice,
  mois: number,
  saisi: number,
): number[][] {
  const enVigueur = repartirSurExercice(montantsAnnuels[cible.index] ?? 0, repartition, cible);
  const existantes = repartition.type === 'mensuel' ? repartition.montants : [];

  return exercices.map((e) =>
    e.index === cible.index
      ? enVigueur.map((v, i) => (i === mois ? saisi : v))
      : [...(existantes[e.index] ?? [])],
  );
}

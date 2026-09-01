import { describe, expect, it } from 'vitest';
import { calculer, repartirSurExercice, type Repartition } from '@previs/core';
import { dossierComplet } from '../../core/test/aide.js';
import { matriceApresSaisie } from '../src/ui/repartition.js';

/**
 * L'éditeur de répartition mensuelle, et la perte de chiffre qui s'y cachait.
 *
 * Le moteur, devant une ligne de matrice ABSENTE pour un exercice, y répartit le total
 * annuel en parts égales. La grille, elle, affichait douze zéros — elle mentait donc sur le
 * calcul — et n'écrivait que la cellule touchée : la ligne cessait d'être absente, les onze
 * autres mois valaient zéro pour de bon, et le total s'effondrait au moment même où
 * l'utilisateur venait le vérifier. C'est la première règle du projet prise à l'envers :
 * ne jamais inventer un chiffre suppose de ne jamais en perdre un.
 */
describe('la matrice mensuelle après une saisie', () => {
  const exercices = calculer(dossierComplet('IS')).exercices;
  const cible = exercices[0];

  it('une ligne absente est écrite entière, et le total ne bouge que de la cellule touchée', () => {
    // 13 000 € sur un exercice de douze mois : le moteur en fait douze parts égales.
    const annuels = [13_000];
    const avant: Repartition = { type: 'mensuel', montants: [] };
    const enVigueur = repartirSurExercice(13_000, avant, cible);
    expect(enVigueur.reduce((t, v) => t + v, 0)).toBeCloseTo(13_000, 2);

    const apres = matriceApresSaisie(exercices, avant, annuels, cible, 0, 500);

    // Le mois touché porte la saisie, les onze autres gardent ce qu'ils valaient.
    expect(apres[cible.index][0]).toBe(500);
    expect(apres[cible.index].slice(1)).toEqual(enVigueur.slice(1));
    // Et le total ne varie que de l'écart demandé, non de 12 500 €.
    const total = apres[cible.index].reduce((t, v) => t + v, 0);
    expect(total).toBeCloseTo(13_000 - enVigueur[0] + 500, 2);
  });

  it('la ligne écrite couvre tous les mois de l’exercice, pas douze par convention', () => {
    // Un premier exercice long en compte jusqu'à vingt-quatre, et ses mois au-delà du
    // douzième étaient inatteignables dans la grille comme dans la matrice écrite.
    const base = dossierComplet('IS');
    const long = calculer({
      ...base,
      parametres: { ...base.parametres, dureePremierExerciceMois: 18 },
    }).exercices;
    expect(long[0].nbMois).toBe(18);

    const apres = matriceApresSaisie(long, { type: 'mensuel', montants: [] }, [18_000], long[0], 0, 0);
    expect(apres[0]).toHaveLength(18);
  });

  it('les exercices non touchés restent absents, et gardent donc leur répartition', () => {
    // Figer au passage un exercice que l'utilisateur n'a pas ouvert reviendrait à décider
    // pour lui : sa ligne doit rester absente, donc déduite de son total annuel.
    const annuels = exercices.map(() => 12_000);
    const apres = matriceApresSaisie(exercices, { type: 'mensuel', montants: [] }, annuels, cible, 3, 999);

    for (const e of exercices) {
      if (e.index === cible.index) continue;
      expect(apres[e.index], `exercice ${e.index + 1}`).toEqual([]);
      // Et le moteur continue d'y répartir le total annuel.
      const vu = repartirSurExercice(12_000, { type: 'mensuel', montants: apres }, e);
      expect(vu.reduce((t, v) => t + v, 0)).toBeCloseTo(12_000, 2);
    }
  });

  it('une ligne déjà saisie n’est pas recalculée : seule la cellule touchée change', () => {
    const saisie = Array.from({ length: cible.nbMois }, (_, i) => (i === 5 ? 7_000 : 0));
    const avant: Repartition = { type: 'mensuel', montants: [saisie] };
    const apres = matriceApresSaisie(exercices, avant, [7_000], cible, 6, 1_000);

    expect(apres[cible.index][5]).toBe(7_000);
    expect(apres[cible.index][6]).toBe(1_000);
    expect(apres[cible.index].reduce((t, v) => t + v, 0)).toBe(8_000);
  });
});

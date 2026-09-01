import { describe, expect, it } from 'vitest';
import { calculer } from '../src/engine/index.js';
import { ajusterSeries, dossierVide, normaliserDossier } from '../src/model/dossier.js';
import { completerLigne, SCHEMAS_LIGNE, zCheminListe } from '../src/api/contract.js';
import { dossier, dossierComplet } from './aide.js';

/**
 * Le moteur ne valide plus le dossier à chaque appel : la validation est faite aux
 * frontières. Ces tests protègent les invariants dont dépend cette optimisation.
 */
describe('invariants du chemin de calcul rapide', () => {
  it('calculer() ne modifie jamais le dossier reçu', () => {
    const d = dossierComplet('IS');
    const avant = JSON.stringify(d);
    calculer(d);
    expect(JSON.stringify(d)).toBe(avant);
  });

  it('ajusterSeries() renvoie le même objet quand rien ne change', () => {
    const d = dossierComplet('IS');
    expect(ajusterSeries(d)).toBe(d);
    // L'identité des lignes est préservée : c'est ce qui permet à l'interface de ne
    // redessiner que la ligne modifiée.
    const ajuste = ajusterSeries(d);
    expect(ajuste.charges.lignes).toBe(d.charges.lignes);
    expect(ajuste.recettes.lignes[0]).toBe(d.recettes.lignes[0]);
  });

  it('ajusterSeries() complète les séries quand le nombre d’exercices augmente', () => {
    const d = dossierComplet('IS');
    const etendu = ajusterSeries({ ...d, parametres: { ...d.parametres, nbExercices: 5 } });
    expect(etendu).not.toBe(d);
    for (const ligne of etendu.charges.lignes) expect(ligne.montants).toHaveLength(5);
    for (const ligne of etendu.recettes.lignes) expect(ligne.montants).toHaveLength(5);
    for (const poste of etendu.charges.personnel) {
      expect(poste.effectifs).toHaveLength(5);
      expect(poste.nbMoisParExercice).toHaveLength(5);
      // Le nombre de mois se complète à douze, pas à zéro.
      expect(poste.nbMoisParExercice[4]).toBe(12);
    }
    // Le dossier d'origine n'est pas touché.
    expect(d.charges.lignes[0].montants).toHaveLength(3);
  });

  it('ajusterSeries() tronque les séries quand le nombre d’exercices diminue', () => {
    const d = dossierComplet('IS');
    const reduit = ajusterSeries({ ...d, parametres: { ...d.parametres, nbExercices: 2 } });
    for (const ligne of reduit.charges.lignes) expect(ligne.montants).toHaveLength(2);
    expect(calculer(reduit).exercices).toHaveLength(2);
  });

  it('le moteur accepte un dossier dont les séries sont trop courtes', () => {
    // Simule un dossier écrit par une version antérieure du modèle.
    const d = dossierComplet('IS');
    const tronque = {
      ...d,
      charges: {
        ...d.charges,
        lignes: d.charges.lignes.map((l) => ({ ...l, montants: l.montants.slice(0, 1) })),
      },
    };
    const r = calculer(tronque);
    expect(r.bilans).toHaveLength(3);
    expect(Math.abs(r.bilans[2].ecart)).toBeLessThanOrEqual(1);
  });
});

describe('complétion des lignes créées depuis l’interface', () => {
  it('chaque liste du contrat possède un schéma', () => {
    for (const chemin of zCheminListe.options) {
      expect(SCHEMAS_LIGNE[chemin], `schéma manquant pour ${chemin}`).toBeDefined();
    }
  });

  it('une ligne partielle est complétée de toutes ses valeurs par défaut', () => {
    const charge = completerLigne('charges.lignes', {
      id: 'c1',
      libelle: 'Loyer',
      categorie: 'services_exterieurs',
    });
    expect(charge.repartition).toEqual({ type: 'lineaire' });
    expect(charge.mode).toBe('montant');
    expect(charge.montants).toEqual([]);
    expect(charge.fixe).toBe(true);
    expect(charge.actif).toBe(true);
  });

  it('un dossier rempli de lignes partielles complétées se calcule sans erreur', () => {
    const base = dossierVide();
    const avecLignes = {
      ...base,
      charges: {
        ...base.charges,
        lignes: [completerLigne('charges.lignes', { id: 'c1', libelle: 'Loyer', montants: [1000, 1000, 1000] })],
      },
      recettes: {
        lignes: [completerLigne('recettes.lignes', { id: 'r1', libelle: 'Ventes', montants: [50000, 55000, 60000] })],
      },
      investissements: {
        ...base.investissements,
        lignes: [completerLigne('investissements.lignes', { id: 'i1', libelle: 'Matériel', montantHT: 10000 })],
      },
    } as typeof base;

    const r = calculer(ajusterSeries(avecLignes));
    expect(r.compteResultat[0].chiffreAffaires).toBe(50000);
    expect(r.compteResultat[0].dotationsAmortissements).toBeGreaterThan(0);
    for (const b of r.bilans) expect(Math.abs(b.ecart)).toBeLessThanOrEqual(1);
  });
});

/**
 * Le coût du calcul, mesuré au **minimum** de plusieurs lots.
 *
 * Le minimum, et non la moyenne : la contention d'une machine chargée ne peut que
 * RALENTIR un lot, jamais l'accélérer. Le plus rapide des lots est donc la mesure la moins
 * polluée — et, à seuil égal, la plus sévère.
 *
 * La version précédente prenait la moyenne d'un seul lot après un unique appel de chauffe.
 * Elle mesurait surtout l'interpréteur de V8 : elle a rendu 5,63 ms, contre un seuil de 5,
 * pendant que les autres fichiers d'essai tournaient en parallèle — pour un coût réel
 * mesuré à 1,23 ms. Un essai de performance qui échoue au hasard finit par être desserré ;
 * c'est ainsi qu'on perd un facteur deux sans que rien ne le signale.
 */
function coutMinimal(travail: () => void, iterations = 20, lots = 5): number {
  // Trois passes complètes avant de mesurer : sans elles, c'est le code non encore
  // optimisé qui est chronométré, et il est cinq fois plus lent.
  for (let i = 0; i < iterations * 3; i++) travail();
  let meilleur = Infinity;
  for (let lot = 0; lot < lots; lot++) {
    const debut = performance.now();
    for (let i = 0; i < iterations; i++) travail();
    meilleur = Math.min(meilleur, (performance.now() - debut) / iterations);
  }
  return meilleur;
}

/** Un dossier complet auquel on ajoute `n` lignes de charges. */
function dossierDeNLignes(n: number) {
  const base = dossierComplet('IS');
  const lignes = Array.from({ length: n }, (_, i) =>
    completerLigne('charges.lignes', {
      id: `c${i}`,
      libelle: `Charge ${i}`,
      montants: [1000, 1100, 1200],
    }),
  );
  return normaliserDossier({ ...base, charges: { ...base.charges, lignes } });
}

describe('coût du calcul', () => {
  /*
   * Ce seuil-ci est une exigence de produit, pas un garde-fou de régression : il dit ce
   * qu'une machine doit tenir pour que la saisie reste fluide, et il doit donc rester
   * généreux — le VPS n'a pas les cœurs d'un poste de développement. Les deux essais
   * suivants, eux, sont des rapports : ils ne dépendent pas de la machine, et c'est eux
   * qui attrapent une régression.
   */
  it('reste sous cinq millisecondes sur un dossier de deux cents lignes', () => {
    const gros = dossierDeNLignes(200);
    const cout = coutMinimal(() => calculer(gros));
    expect(cout, `${cout.toFixed(2)} ms par calcul`).toBeLessThan(5);
  });

  it('un dossier vide se calcule en moins d’une milliseconde', () => {
    const vide = dossier();
    const cout = coutMinimal(() => calculer(vide), 50);
    expect(cout, `${cout.toFixed(2)} ms par calcul`).toBeLessThan(1);
  });

  /*
   * Le garde-fou du premier invariant : `calculer()` ne valide pas.
   *
   * Le rapport est mesuré sur la même machine, dans la même seconde, contre la validation
   * qu'il s'agit précisément de ne pas refaire. Il vaut 0,84 ici ; remettre
   * `normaliserDossier()` dans `calculer()` le porterait à 1,9 — c'est la somme des deux.
   * Un seuil de 1,5 laisse la moitié du chemin de part et d'autre, et ne dépend d'aucun
   * matériel.
   *
   * Éprouvé : la mutation rend « calculer 3,13 ms · normaliserDossier 1,35 ms · rapport
   * 2,31 ». Le seuil de cinq millisecondes ci-dessus, lui, passait sans broncher — c'est
   * exactement le facteur deux que l'ancien essai laissait filer.
   */
  it('calculer() coûte moins que la validation qu’il ne fait pas', () => {
    const gros = dossierDeNLignes(200);
    const calcul = coutMinimal(() => calculer(gros));
    const validation = coutMinimal(() => normaliserDossier(gros));
    const rapport = calcul / validation;
    expect(
      rapport,
      `calculer ${calcul.toFixed(2)} ms · normaliserDossier ${validation.toFixed(2)} ms · rapport ${rapport.toFixed(2)}`,
    ).toBeLessThan(1.5);
  });

  /*
   * Le second garde-fou : le coût suit le nombre de lignes, il ne l'élève pas au carré.
   *
   * Doubler les lignes coûte 1,7 fois plus ici — moins de deux, le dossier gardant un socle
   * fixe. Éprouvé : un cumul « toutes les autres lignes de la même catégorie » glissé dans
   * la boucle mensuelle des charges rend « 200 lignes 4,15 ms · 400 lignes 12,64 ms ·
   * rapport 3,05 ». Là encore, le seuil de cinq millisecondes passait à deux cents lignes,
   * pendant qu'un dossier de quatre cents en demandait douze.
   */
  it('doubler les lignes ne quadruple pas le coût', () => {
    const petit = dossierDeNLignes(200);
    const grand = dossierDeNLignes(400);
    const coutPetit = coutMinimal(() => calculer(petit));
    const coutGrand = coutMinimal(() => calculer(grand));
    const rapport = coutGrand / coutPetit;
    expect(
      rapport,
      `200 lignes ${coutPetit.toFixed(2)} ms · 400 lignes ${coutGrand.toFixed(2)} ms · rapport ${rapport.toFixed(2)}`,
    ).toBeLessThan(2.5);
  });
});

/**
 * Ce que devient une répartition mensuelle quand le prévisionnel s'allonge.
 *
 * `ajusterSeries()` complète les tableaux « par exercice » — c'est l'objet des essais
 * ci-dessus — mais il ne touche pas la matrice d'une répartition mensuelle : trois lignes
 * restent trois lignes. Et `totauxAnnuelsDepuisRepartition()` fait primer le mensuel sur
 * l'annuel. Une charge portée de trois à cinq exercices rendait donc ZÉRO sur les deux
 * nouveaux, quel que soit le montant saisi dans la grille.
 *
 * C'est le versant « chiffre qui s'évapore » de la première règle du projet : la charge
 * disparaissait du compte de résultat, de la trésorerie, du bilan et du PDF remis au
 * banquier, et l'écart de bilan restait nul — zéro est parfaitement cohérent.
 */
describe('une répartition mensuelle survit à l’allongement du prévisionnel', () => {
  function loyerMensuel(nbExercices: number, montants: number[], lignesMatrice: number) {
    const base = dossierComplet('IS');
    const ligne = completerLigne('charges.lignes', {
      id: 'loyer',
      libelle: 'Loyer du local',
      montants,
      repartition: {
        type: 'mensuel',
        montants: Array.from({ length: lignesMatrice }, () =>
          Array.from({ length: 12 }, () => 1000),
        ),
      },
    });
    return ajusterSeries({
      ...base,
      parametres: { ...base.parametres, nbExercices },
      charges: { ...base.charges, lignes: [ligne] },
    } as typeof base);
  }

  /** Les totaux annuels de la seule ligne qui nous intéresse, et non ceux de la section. */
  function totauxDuLoyer(d: ReturnType<typeof loyerMensuel>): number[] {
    return calculer(d).charges.detail.find((l) => l.ligneId === 'loyer')!.montants;
  }

  it('le montant annuel est repris là où aucune grille mensuelle n’existe', () => {
    const totaux = totauxDuLoyer(loyerMensuel(5, [12000, 12000, 12000, 13000, 13000], 3));
    expect(totaux[3], 'exercice 4').toBe(13000);
    expect(totaux[4], 'exercice 5').toBe(13000);
    // Et les trois premiers exercices restent gouvernés par leur grille mensuelle.
    expect(totaux[0]).toBe(12000);
  });

  it('la trésorerie porte le même montant, réparti sur les mois de l’exercice', () => {
    const d = loyerMensuel(5, [12000, 12000, 12000, 13000, 13000], 3);
    const r = calculer(d);
    const detail = r.charges.detail.find((l) => l.ligneId === 'loyer')!;
    const exercice4 = r.exercices[3];
    const mois = detail.mensuel.slice(
      exercice4.moisDebutAbsolu,
      exercice4.moisDebutAbsolu + exercice4.nbMois,
    );
    expect(mois.reduce((t, v) => t + v, 0)).toBeCloseTo(13000, 2);
  });

  it('une grille mensuelle toute à zéro reste un zéro voulu', () => {
    const base = dossierComplet('IS');
    const ligne = completerLigne('charges.lignes', {
      id: 'loyer',
      libelle: 'Loyer du local',
      montants: [12000, 12000, 12000],
      repartition: {
        type: 'mensuel',
        // Le troisième exercice est explicitement à zéro : local rendu, plus de loyer.
        montants: [
          Array.from({ length: 12 }, () => 1000),
          Array.from({ length: 12 }, () => 1000),
          Array.from({ length: 12 }, () => 0),
        ],
      },
    });
    const r = calculer(
      ajusterSeries({ ...base, charges: { ...base.charges, lignes: [ligne] } } as typeof base),
    );
    expect(r.charges.detail.find((l) => l.ligneId === 'loyer')!.montants[2]).toBe(0);
  });

  it('et le bilan reste équilibré dans tous les cas', () => {
    for (const nb of [3, 5, 8]) {
      const d = loyerMensuel(nb, Array.from({ length: nb }, () => 12000), 3);
      for (const b of calculer(d).bilans) {
        expect(Math.abs(b.ecart), `${nb} exercices`).toBeLessThanOrEqual(1);
      }
    }
  });

  /*
   * Les trois autres listes qui portent une répartition.
   *
   * Le chemin est le même, mais il ne suffit pas de le dire : les charges y passent par
   * `totauxAnnuelsDepuisRepartition`, la section Autres non — son annuel vient directement
   * de `ligne.montants` tandis que son mensuel vient de `repartirSurCalendrier`. Les deux
   * moitiés divergeaient donc, et là où une charge s'évaporait en silence, un exceptionnel
   * DÉSÉQUILIBRAIT le bilan : mesuré avant correction, 20 000,04 € puis 40 000,04 € d'écart
   * et quatre contrôles en échec. Un chiffre d'affaires qui s'évapore est par ailleurs plus
   * grave qu'une charge : c'est lui que le banquier regarde d'abord.
   */
  function avecLigneMensuelle(
    nbExercices: number,
    liste: 'recettes.lignes' | 'autres.exceptionnels' | 'autres.distributions',
    montants: number[],
    lignesMatrice: number,
  ) {
    const base = dossierComplet('IS');
    const commun = {
      id: 'cible',
      libelle: 'Ligne éprouvée',
      montants,
      repartition: {
        type: 'mensuel' as const,
        montants: Array.from({ length: lignesMatrice }, () => Array.from({ length: 12 }, () => 1000)),
      },
    };
    const ligne = completerLigne(liste, commun);
    const parametres = { ...base.parametres, nbExercices };

    if (liste === 'recettes.lignes') {
      return ajusterSeries({
        ...base,
        parametres,
        recettes: { ...base.recettes, lignes: [ligne] },
      } as typeof base);
    }
    const cle = liste === 'autres.exceptionnels' ? 'exceptionnels' : 'distributions';
    return ajusterSeries({
      ...base,
      parametres,
      autres: { ...base.autres, [cle]: [ligne] },
    } as typeof base);
  }

  it('un chiffre d’affaires ne s’évapore pas des exercices ajoutés', () => {
    const d = avecLigneMensuelle(5, 'recettes.lignes', [240000, 250000, 255000, 260000, 260000], 3);
    const r = calculer(d);
    const detail = r.recettes.detail.find((l) => l.ligneId === 'cible')!;
    expect(detail.montants[3], 'exercice 4').toBe(260000);
    expect(detail.montants[4], 'exercice 5').toBe(260000);
    // Et il arrive bien jusqu'au chiffre d'affaires du compte de résultat.
    expect(r.compteResultat[3].chiffreAffaires).toBeGreaterThanOrEqual(260000);
  });

  it('un produit exceptionnel n’ouvre pas d’écart de bilan sur les exercices ajoutés', () => {
    // La grille de trois lignes vaut 12 000 € par exercice ; le montant annuel saisi, lui,
    // est nul sur les trois premiers. C'est cette divergence qui déséquilibrait le bilan,
    // et elle est indépendante de l'allongement — d'où les trois premiers exercices ici.
    const d = avecLigneMensuelle(5, 'autres.exceptionnels', [0, 0, 0, 20000, 20000], 3);
    const r = calculer(d);

    // Le témoin porte l'arrondi propre au dossier d'essai, quatre centimes : ce qu'on
    // éprouve est que la ligne ajoutée n'y ajoute RIEN, non que l'écart soit nul.
    const temoin = avecLigneMensuelle(5, 'autres.exceptionnels', [0, 0, 0, 0, 0], 0);
    const ecartsTemoin = calculer(temoin).bilans.map((b) => Math.abs(b.ecart));

    r.bilans.forEach((b, i) => {
      expect(Math.abs(b.ecart), `exercice ${i + 1}`).toBeLessThanOrEqual(ecartsTemoin[i] + 0.01);
    });

    // Et le compte de résultat porte bien ce que la grille dit, non le montant annuel nul :
    // douze mille de plus que le témoin, sur un premier exercice saisi à zéro.
    const t = calculer(temoin);
    expect(
      r.compteResultat[0].produitsExceptionnels - t.compteResultat[0].produitsExceptionnels,
    ).toBeCloseTo(12000, 2);
  });

  it('une distribution portée sur un exercice ajouté garde son montant et son équilibre', () => {
    const d = avecLigneMensuelle(5, 'autres.distributions', [0, 12000, 12000, 15000, 15000], 3);
    const r = calculer(d);
    for (const b of r.bilans) {
      expect(Math.abs(b.ecart), `exercice ${b.exercice + 1}`).toBeLessThanOrEqual(1);
    }
    // La distribution du cinquième exercice sort bien de la trésorerie.
    const ex5 = r.exercices[4];
    const flux = r.tresorerie.mensuelle
      .slice(ex5.moisDebutAbsolu, ex5.moisDebutAbsolu + ex5.nbMois)
      .reduce((t, m) => t + m.decaissements.distributions, 0);
    expect(flux).toBeCloseTo(15000, 2);
  });
});

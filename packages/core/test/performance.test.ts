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

describe('coût du calcul', () => {
  it('reste sous cinq millisecondes sur un dossier de deux cents lignes', () => {
    const base = dossierComplet('IS');
    const lignes = Array.from({ length: 200 }, (_, i) =>
      completerLigne('charges.lignes', {
        id: `c${i}`,
        libelle: `Charge ${i}`,
        montants: [1000, 1100, 1200],
      }),
    );
    const gros = normaliserDossier({ ...base, charges: { ...base.charges, lignes } });

    calculer(gros);
    const debut = performance.now();
    for (let i = 0; i < 20; i++) calculer(gros);
    const moyenne = (performance.now() - debut) / 20;
    expect(moyenne, `${moyenne.toFixed(2)} ms par calcul`).toBeLessThan(5);
  });

  it('un dossier vide se calcule en moins d’une milliseconde', () => {
    const vide = dossier();
    calculer(vide);
    const debut = performance.now();
    for (let i = 0; i < 50; i++) calculer(vide);
    const moyenne = (performance.now() - debut) / 50;
    expect(moyenne, `${moyenne.toFixed(2)} ms par calcul`).toBeLessThan(1);
  });
});

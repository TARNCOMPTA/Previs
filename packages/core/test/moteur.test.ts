import { describe, expect, it } from 'vitest';
import { calculer } from '../src/engine/index.js';
import { cotisationsExploitant, impotSocietes } from '../src/engine/fiscal.js';
import { tableauAmortissement } from '../src/engine/emprunts.js';
import { planAmortissement } from '../src/engine/immobilisations.js';
import { construireExercices, moisAbsoluDansHorizon } from '../src/engine/periodes.js';
import { dossierVide, normaliserDossier } from '../src/model/dossier.js';
import { modeleDossier } from '../src/modeles/index.js';
import { dossier, dossierComplet } from './aide.js';

const TOLERANCE = 1;

describe('robustesse', () => {
  it('un dossier vide ne lève pas et produit des états à zéro', () => {
    const r = calculer(dossierVide());
    expect(r.exercices).toHaveLength(3);
    expect(r.nbMois).toBe(36);
    expect(r.compteResultat.every((c) => c.resultatNet === 0)).toBe(true);
    expect(r.bilans.every((b) => Math.abs(b.ecart) <= TOLERANCE)).toBe(true);
    expect(r.tresorerie.mensuelle).toHaveLength(36);
  });

  it('les modèles par régime se calculent sans erreur', () => {
    for (const regime of ['IS', 'BNC', 'BIC_IR'] as const) {
      const r = calculer(modeleDossier(regime));
      expect(r.bilans.every((b) => Math.abs(b.ecart) <= TOLERANCE)).toBe(true);
    }
  });

  it('un exercice long et un nombre d’exercices inhabituel sont acceptés', () => {
    const r = calculer(
      dossier({ parametres: { nbExercices: 7, dureePremierExerciceMois: 18, dateDebut: '2026-07-01' } }),
    );
    expect(r.exercices).toHaveLength(7);
    expect(r.nbMois).toBe(18 + 6 * 12);
    expect(r.exercices[0].libelle).toBe('2026-2027');
    expect(r.libellesMois[0]).toBe('juil. 2026');
  });
});

describe('amortissements', () => {
  const exercices = construireExercices(normaliserDossier({}).parametres);

  it('amortit au prorata des mois à partir du mois d’acquisition', () => {
    const plan = planAmortissement(
      {
        id: 'a', libelle: 'Matériel', note: undefined, origine: 'manuel', actif: true,
        categorie: 'corporel', compte: undefined, montantHT: 12000, tauxTva: 20, tvaRecuperable: true,
        exercice: 0, mois: 7, modeAmortissement: 'lineaire', dureeAmortissementAnnees: 5,
        valeurResiduelle: 0, financeParEmpruntId: undefined, echelonnementMois: 1,
      },
      exercices,
    );
    // Six mois d'amortissement la première année, puis douze.
    expect(plan.dotations[0]).toBeCloseTo(1200, 2);
    expect(plan.dotations[1]).toBeCloseTo(2160, 0);
    expect(plan.cumules[2]).toBeGreaterThan(plan.cumules[1]);
    expect(plan.vnc[2]).toBeCloseTo(12000 - plan.cumules[2], 2);
  });

  it('le dégressif dote davantage la première année que le linéaire', () => {
    const commun = {
      id: 'a', libelle: 'Véhicule', note: undefined, origine: 'manuel' as const, actif: true,
      categorie: 'corporel' as const, compte: undefined, montantHT: 24000, tauxTva: 20,
      tvaRecuperable: true, exercice: 0, mois: 1, dureeAmortissementAnnees: 5,
      valeurResiduelle: 0, financeParEmpruntId: undefined, echelonnementMois: 1,
    };
    const lineaire = planAmortissement({ ...commun, modeAmortissement: 'lineaire' }, exercices);
    const degressif = planAmortissement({ ...commun, modeAmortissement: 'degressif' }, exercices);
    expect(degressif.dotations[0]).toBeGreaterThan(lineaire.dotations[0]);
    // Coefficient 1,75 pour une durée de 5 ans : 24 000 × 20 % × 1,75 = 8 400.
    expect(degressif.dotations[0]).toBeCloseTo(8400, 0);
  });

  it('n’amortit jamais un stock de départ ni une trésorerie de démarrage', () => {
    for (const categorie of ['stock_initial', 'tresorerie_demarrage', 'financier'] as const) {
      const plan = planAmortissement(
        {
          id: 'a', libelle: 'x', note: undefined, origine: 'manuel', actif: true,
          categorie, compte: undefined, montantHT: 10000, tauxTva: 20, tvaRecuperable: true,
          exercice: 0, mois: 1, modeAmortissement: 'lineaire', dureeAmortissementAnnees: 5,
          valeurResiduelle: 0, financeParEmpruntId: undefined, echelonnementMois: 1,
        },
        exercices,
      );
      expect(plan.dotations.every((d) => d === 0)).toBe(true);
    }
  });
});

describe('emprunts', () => {
  const exercices = construireExercices(normaliserDossier({ parametres: { nbExercices: 8 } }).parametres);
  const base = {
    id: 'e', libelle: 'Prêt', note: undefined, origine: 'manuel' as const, actif: true,
    organisme: '', montant: 100000, tauxAnnuel: 3, dureeMois: 84,
    exerciceDeblocage: 0, moisDeblocage: 0 + 1, periodicite: 'mensuelle' as const,
    typeDiffere: 'aucun' as const, differeMois: 0, tauxAssuranceAnnuel: 0,
    assuranceSurCapitalRestant: false, fraisDossier: 0, fraisGarantie: 0,
  };

  it('calcule une mensualité constante et amortit exactement le capital', () => {
    const t = tableauAmortissement(base, exercices);
    expect(t.mensualite).toBeCloseTo(1321.31, 1);
    expect(t.echeances).toHaveLength(84);
    const capital = t.echeances.reduce((s, e) => s + e.capital, 0);
    expect(capital).toBeCloseTo(100000, 1);
    expect(t.echeances[83].capitalRestantDu).toBeCloseTo(0, 1);
  });

  it('en différé partiel, ne règle que les intérêts pendant la franchise', () => {
    const t = tableauAmortissement({ ...base, typeDiffere: 'partiel', differeMois: 12 }, exercices);
    for (let k = 0; k < 12; k++) {
      expect(t.echeances[k].capital).toBe(0);
      expect(t.echeances[k].echeance).toBeCloseTo(t.echeances[k].interets, 2);
    }
    expect(t.echeances[12].capital).toBeGreaterThan(0);
    const capital = t.echeances.reduce((s, e) => s + e.capital, 0);
    expect(capital).toBeCloseTo(100000, 1);
  });

  it('en différé total, capitalise les intérêts et augmente le capital restant dû', () => {
    const t = tableauAmortissement({ ...base, typeDiffere: 'total', differeMois: 12 }, exercices);
    expect(t.echeances[0].echeance).toBe(0);
    expect(t.echeances[0].capital).toBeLessThan(0);
    expect(t.echeances[11].capitalRestantDu).toBeGreaterThan(100000);
  });

  it('applique l’assurance sur le capital initial ou sur le capital restant dû', () => {
    const initial = tableauAmortissement({ ...base, tauxAssuranceAnnuel: 0.36 }, exercices);
    const restant = tableauAmortissement(
      { ...base, tauxAssuranceAnnuel: 0.36, assuranceSurCapitalRestant: true },
      exercices,
    );
    expect(initial.echeances[0].assurance).toBeCloseTo((100000 * 0.0036) / 12, 2);
    expect(restant.echeances[50].assurance).toBeLessThan(initial.echeances[50].assurance);
  });

  it('gère une périodicité trimestrielle', () => {
    const t = tableauAmortissement({ ...base, periodicite: 'trimestrielle' }, exercices);
    expect(t.echeances).toHaveLength(28);
    const capital = t.echeances.reduce((s, e) => s + e.capital, 0);
    expect(capital).toBeCloseTo(100000, 1);
  });
});

describe('fiscalité', () => {
  const parametres = normaliserDossier({}).parametres;

  it('résout exactement la circularité des cotisations de l’exploitant', () => {
    const cotisations = cotisationsExploitant(100000, parametres);
    // C = t × (R − C) avec t = 45 % : C = 0,45 × 100 000 / 1,45.
    expect(cotisations).toBeCloseTo((0.45 * 100000) / 1.45, 1);
    // Le résultat après cotisations, réassujetti au taux, redonne bien la cotisation.
    expect((100000 - cotisations) * 0.45).toBeCloseTo(cotisations, 1);
  });

  it('applique le plancher de cotisations minimales sur un résultat nul', () => {
    expect(cotisationsExploitant(0, parametres)).toBe(parametres.tns.cotisationsMinimales);
  });

  it('applique le taux réduit d’IS puis le taux normal au-delà du plafond', () => {
    expect(impotSocietes(30000, 0, parametres).impot).toBeCloseTo(4500, 2);
    // 42 500 à 15 % puis 17 500 à 25 %.
    expect(impotSocietes(60000, 0, parametres).impot).toBeCloseTo(42500 * 0.15 + 17500 * 0.25, 2);
  });

  it('reporte les déficits sur les exercices bénéficiaires suivants', () => {
    const perte = impotSocietes(-20000, 0, parametres);
    expect(perte.impot).toBe(0);
    expect(perte.deficitRestant).toBe(20000);
    const suivant = impotSocietes(30000, 20000, parametres);
    expect(suivant.baseImposable).toBe(10000);
    expect(suivant.impot).toBeCloseTo(1500, 2);
    expect(suivant.deficitRestant).toBe(0);
  });
});

describe.each(['IS', 'BNC', 'BIC_IR'] as const)('dossier complet — régime %s', (regime) => {
  const r = calculer(dossierComplet(regime));

  it('équilibre le bilan sur chaque exercice', () => {
    for (const b of r.bilans) {
      expect(Math.abs(b.ecart), `exercice ${b.exercice} : écart de ${b.ecart} €`).toBeLessThanOrEqual(
        TOLERANCE,
      );
      expect(b.actif.total).toBeCloseTo(b.passif.total, 0);
    }
  });

  it('valide les cinq contrôles de cohérence obligatoires', () => {
    const obligatoires = [
      'bilan_equilibre',
      'bfr_bilan',
      'plan_tresorerie',
      'resultat_bilan',
      'amortissements_cumules',
      'tva_annuelle',
    ];
    for (const code of obligatoires) {
      const echecs = r.controles.filter((c) => c.code === code && !c.ok);
      expect(
        echecs,
        `${code} : ${echecs.map((e) => `exercice ${e.exercice} écart ${e.ecart} €`).join(', ')}`,
      ).toHaveLength(0);
    }
  });

  it('reconstitue le solde de trésorerie de fin d’exercice à partir des flux mensuels', () => {
    let solde = r.tresorerie.mensuelle[0].soldeInitial;
    for (const mois of r.tresorerie.mensuelle) {
      solde = Math.round((solde + mois.variation) * 100) / 100;
    }
    const dernier = r.tresorerie.mensuelle[r.tresorerie.mensuelle.length - 1];
    expect(solde).toBeCloseTo(dernier.soldeFinal, 1);
    expect(r.tresorerie.soldeFinParExercice[2]).toBeCloseTo(dernier.soldeFinal, 1);
  });

  it('reporte le résultat net du compte de résultat au bilan', () => {
    for (let i = 0; i < r.compteResultat.length; i++) {
      expect(r.bilans[i].passif.resultatExercice).toBeCloseTo(r.compteResultat[i].resultatNet, 2);
    }
  });

  it('produit un chiffre d’affaires strictement positif et croissant', () => {
    expect(r.compteResultat[0].chiffreAffaires).toBeGreaterThan(0);
    expect(r.compteResultat[1].chiffreAffaires).toBeGreaterThan(r.compteResultat[0].chiffreAffaires);
  });

  it('ventile le chiffre d’affaires annuel sur les mois sans rien perdre', () => {
    for (const e of r.exercices) {
      let cumul = 0;
      for (let m = e.moisDebutAbsolu; m < e.moisDebutAbsolu + e.nbMois; m++) {
        cumul += r.recettes.caMensuel[m];
      }
      expect(cumul).toBeCloseTo(r.recettes.caParExercice[e.index], 0);
    }
  });
});

describe('spécificités par régime', () => {
  it('à l’IS, l’impôt sur les sociétés est une charge et l’IR estimé reste nul', () => {
    const r = calculer(dossierComplet('IS'));
    expect(r.compteResultat.some((c) => c.impotSocietes > 0)).toBe(true);
    expect(r.compteResultat.every((c) => c.impotRevenuEstime === 0)).toBe(true);
  });

  it('en BNC, les prélèvements ne sont pas déductibles et il n’y a pas d’IS', () => {
    const r = calculer(dossierComplet('BNC'));
    expect(r.compteResultat.every((c) => c.impotSocietes === 0)).toBe(true);
    const praticien = r.charges.personnel.find((p) => p.statut === 'exploitant');
    expect(praticien?.nonDeductible).toBe(true);
    // Les prélèvements ne figurent pas dans les salaires bruts du compte de résultat.
    expect(r.compteResultat[0].salairesBruts).toBe(0);
    // Les cotisations sociales de l'exploitant, elles, sont bien une charge.
    expect(r.compteResultat[0].chargesSociales).toBeGreaterThan(0);
  });

  it('en BNC, aucune TVA n’est collectée ni déductible', () => {
    const r = calculer(dossierComplet('BNC'));
    expect(r.tva.periodes).toHaveLength(0);
    expect(r.tva.parExercice.every((t) => t.collectee === 0 && t.deductible === 0)).toBe(true);
  });

  it('en BIC à l’IR, l’impôt sur le revenu est estimé sans être une charge', () => {
    const r = calculer(dossierComplet('BIC_IR'));
    const c = r.compteResultat[1];
    expect(c.impotSocietes).toBe(0);
    if (c.resultatAvantImpot > 0) expect(c.impotRevenuEstime).toBeGreaterThan(0);
    expect(c.resultatNet).toBeCloseTo(c.resultatAvantImpot, 2);
  });
});

describe('cohérence des états entre eux', () => {
  const r = calculer(dossierComplet('IS'));

  it('la capacité d’autofinancement se déduit du résultat et des dotations', () => {
    for (let i = 0; i < r.caf.length; i++) {
      const attendu =
        r.compteResultat[i].resultatNet +
        r.compteResultat[i].dotationsAmortissements -
        r.caf[i].repriseSubventions -
        r.caf[i].plusValuesCession;
      expect(r.caf[i].caf).toBeCloseTo(attendu, 2);
    }
  });

  it('les soldes intermédiaires de gestion aboutissent au résultat net', () => {
    for (let i = 0; i < r.sig.length; i++) {
      expect(r.sig[i].resultatNet).toBeCloseTo(r.compteResultat[i].resultatNet, 2);
      expect(r.sig[i].resultatExploitation).toBeCloseTo(r.compteResultat[i].resultatExploitation, 2);
    }
  });

  it('le besoin en fonds de roulement varie de façon cohérente d’un exercice à l’autre', () => {
    for (let i = 1; i < r.bfr.length; i++) {
      expect(r.bfr[i].variation).toBeCloseTo(r.bfr[i].bfr - r.bfr[i - 1].bfr, 2);
    }
  });

  it('la TVA collectée diminuée de la déductible donne le solde de chaque déclaration', () => {
    for (const p of r.tva.periodes) {
      expect(p.solde).toBeCloseTo(
        p.collectee - p.deductibleBiensServices - p.deductibleImmobilisations,
        2,
      );
    }
  });

  it('le seuil de rentabilité se déduit des charges fixes et du taux de marge', () => {
    for (const s of r.seuilRentabilite) {
      if (s.tauxMargeSurCoutVariable > 0) {
        expect(s.seuil).toBeCloseTo(s.chargesFixes / (s.margeSurCoutVariable / s.chiffreAffaires), 0);
      }
      expect(s.seuilFinancier).toBeGreaterThanOrEqual(s.seuil);
    }
  });

  it('signale les lignes proposées par l’assistant comme des anomalies de saisie utiles', () => {
    const vide = calculer(dossierVide());
    expect(vide.anomalies.some((a) => a.code === 'ca_absent')).toBe(true);
    expect(vide.anomalies.some((a) => a.code === 'identite_incomplete')).toBe(true);
  });
});

describe('lignes hors de l’horizon du dossier', () => {
  /*
   * Le cas est atteignable depuis l'interface : il suffit de réduire le nombre d'exercices
   * d'un dossier qui porte une cession, un apport ou un emprunt sur un exercice ultérieur.
   *
   * « moisAbsolu » ramenait alors l'index d'exercice dans l'horizon, si bien que la trésorerie
   * partait sur le dernier exercice tandis que l'écriture indexée par exercice tombait hors du
   * tableau : le bilan se déséquilibrait du montant exact de la ligne. La trame d'essai porte
   * une cession de 9 000 € sur l'exercice 2 ; réduite à un exercice, l'écart valait 9 000,04 €.
   */
  it('le bilan reste équilibré quel que soit le nombre d’exercices', () => {
    for (const regime of ['IS', 'BNC', 'BIC_IR'] as const) {
      const d = dossierComplet(regime);
      for (const nbExercices of [1, 2, 3, 10]) {
        const r = calculer({ ...d, parametres: { ...d.parametres, nbExercices } });
        const erreurs = r.controles.filter((c) => !c.ok && c.gravite === 'erreur');
        expect(
          erreurs.map((c) => `${regime}/${nbExercices} : ${c.code} — ${c.message}`),
        ).toEqual([]);
        expect(r.bilans.every((b) => Math.abs(b.ecart) <= TOLERANCE)).toBe(true);
      }
    }
  });

  it('une ligne rendue inopérante est signalée, jamais tue', () => {
    const d = dossierComplet('IS');
    const r = calculer({ ...d, parametres: { ...d.parametres, nbExercices: 1 } });
    const avertissement = r.controles.find((c) => c.code === 'lignes_hors_horizon');
    expect(avertissement).toBeDefined();
    expect(avertissement?.ok).toBe(false);
    expect(avertissement?.gravite).toBe('avertissement');
    // Le message nomme la ligne et son exercice : sans cela, l'utilisateur la chercherait.
    expect(avertissement?.message).toContain('Revente du véhicule');
    expect(avertissement?.message).toContain('exercice 3');
    // Un avertissement ne rend pas le dossier incohérent : il reste transmissible.
    expect(r.coherent).toBe(true);
  });

  it('« moisAbsoluDansHorizon » refuse tout index qui n’est pas un exercice existant', () => {
    const exercices = construireExercices(dossierComplet('IS').parametres);
    // Ce qui existe se convertit.
    expect(moisAbsoluDansHorizon(exercices, 0, 1)).toBe(0);
    expect(moisAbsoluDansHorizon(exercices, 2, 12)).toBe(35);
    // Ce qui n'existe pas rend « null » plutôt que d'être ramené sur un exercice voisin.
    expect(moisAbsoluDansHorizon(exercices, 3, 1)).toBeNull();
    expect(moisAbsoluDansHorizon(exercices, 99, 1)).toBeNull();
    expect(moisAbsoluDansHorizon(exercices, -1, 1)).toBeNull();
    expect(moisAbsoluDansHorizon(exercices, 1.5, 1)).toBeNull();
    expect(moisAbsoluDansHorizon(exercices, Number.NaN, 1)).toBeNull();
    // Le mois dans l'exercice, lui, reste borné : c'est une saisie à corriger, pas une ligne
    // à faire disparaître.
    expect(moisAbsoluDansHorizon(exercices, 0, 0)).toBe(0);
    expect(moisAbsoluDansHorizon(exercices, 0, 99)).toBe(11);
  });

  it('à l’horizon complet, aucune ligne n’est hors horizon', () => {
    const r = calculer(dossierComplet('IS'));
    expect(r.controles.find((c) => c.code === 'lignes_hors_horizon')).toBeUndefined();
  });

  it('la ligne hors horizon ne produit ni flux ni écriture', () => {
    const d = dossierComplet('IS');
    const reduit = { ...d, parametres: { ...d.parametres, nbExercices: 1 } };
    const r = calculer(reduit);
    // La cession de l'exercice 2 n'encaisse rien sur l'exercice 0.
    expect(r.tresorerie.mensuelle.every((m) => m.encaissements.cessions === 0)).toBe(true);
    // Et aucun produit exceptionnel de cession n'apparaît.
    const sansCession = calculer({
      ...reduit,
      investissements: { ...reduit.investissements, cessions: [] },
    });
    expect(r.compteResultat[0]?.produitsExceptionnels).toBe(
      sansCession.compteResultat[0]?.produitsExceptionnels,
    );
    expect(r.bilans[0]?.actif.total).toBe(sansCession.bilans[0]?.actif.total);
  });
});

describe('bilan d’ouverture', () => {
  it('sans bilan d’ouverture, la trésorerie initiale trouve sa contrepartie au passif', () => {
    const r = calculer(dossier({ parametres: { tresorerieInitiale: 25000 } }));
    expect(r.controles.filter((c) => c.code === 'bilan_ouverture')).toHaveLength(0);
    expect(r.bilans[0].actif.disponibilites).toBe(25000);
    expect(Math.abs(r.bilans[0].ecart)).toBeLessThanOrEqual(TOLERANCE);
    expect(r.coherent).toBe(true);
  });

  it('reprend un bilan d’ouverture équilibré sans créer d’écart', () => {
    const r = calculer(
      dossier({
        parametres: { tresorerieInitiale: 8000 },
        autres: {
          bilanOuverture: {
            actif: true,
            immobilisationsBrutes: 40000,
            amortissementsCumules: 15000,
            stocks: 6000,
            creancesClients: 12000,
            capitalSocial: 10000,
            reportANouveau: 11000,
            empruntsRestantDus: 20000,
            dettesFournisseurs: 8000,
            dettesFiscalesSociales: 2000,
          },
        },
      }),
    );
    expect(r.controles.filter((c) => c.code === 'bilan_ouverture' && !c.ok)).toHaveLength(0);
    expect(Math.abs(r.bilans[0].ecart)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('signale un bilan d’ouverture déséquilibré sans jamais le corriger d’office', () => {
    const r = calculer(
      dossier({
        autres: { bilanOuverture: { actif: true, stocks: 10000, capitalSocial: 4000 } },
      }),
    );
    const controle = r.controles.find((c) => c.code === 'bilan_ouverture');
    expect(controle?.ok).toBe(false);
    expect(controle?.ecart).toBe(6000);
    expect(r.coherent).toBe(false);
    // L'écart se propage au bilan : il n'est jamais absorbé par un compte d'attente.
    expect(Math.abs(r.bilans[0].ecart)).toBeGreaterThan(TOLERANCE);
  });
});

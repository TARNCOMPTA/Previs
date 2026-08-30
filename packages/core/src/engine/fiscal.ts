import type { Parametres } from '../model/parametres.js';
import { exercicePourMois, nbMoisTotal } from './periodes.js';
import type { Exercice, PeriodeTva } from './types.js';
import { euro, pct, zeros } from './utils.js';

/** Nombre de mois d'une période de déclaration de TVA. */
function moisParPeriodeTva(regime: Parametres['tva']['regime']): number {
  return regime === 'mensuel' ? 1 : regime === 'trimestriel' ? 3 : 12;
}

export interface ResultatTva {
  periodes: PeriodeTva[];
  parExercice: Array<{ collectee: number; deductible: number; due: number }>;
  /** TVA effectivement décaissée, par mois absolu. */
  decaissements: number[];
  /** Remboursements de crédit de TVA encaissés, par mois absolu. */
  remboursements: number[];
  /** Crédit de TVA en compte à chaque clôture — une créance à l'actif. */
  creditParExercice: number[];
  /** TVA restant à décaisser à chaque clôture — une dette au passif. */
  dueParExercice: number[];
}

/**
 * Déclarations de TVA sur l'horizon du prévisionnel.
 *
 * Un solde négatif devient un crédit reporté sur la période suivante, ou un
 * remboursement encaissé si le report n'est pas retenu dans les paramètres. La dette
 * et la créance de TVA figurant au bilan sont déduites des mêmes séries que les
 * décaissements, ce qui interdit tout écart entre la trésorerie et le bilan.
 */
export function calculerTva(
  parametres: Parametres,
  exercices: readonly Exercice[],
  collecteeMensuelle: readonly number[],
  deductibleBiensServices: readonly number[],
  deductibleImmobilisations: readonly number[],
  libelles: readonly string[],
): ResultatTva {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const resultat: ResultatTva = {
    periodes: [],
    parExercice: Array.from({ length: n }, () => ({ collectee: 0, deductible: 0, due: 0 })),
    decaissements: zeros(horizon),
    remboursements: zeros(horizon),
    creditParExercice: zeros(n),
    dueParExercice: zeros(n),
  };

  if (!parametres.tva.assujetti || parametres.tva.regime === 'franchise') return resultat;

  const taille = moisParPeriodeTva(parametres.tva.regime);
  const decalage = parametres.tva.decalageDecaissementMois;
  let credit = 0;

  for (let debut = 0; debut < horizon; debut += taille) {
    const fin = Math.min(debut + taille, horizon);
    let collectee = 0;
    let dedBS = 0;
    let dedImmo = 0;
    for (let m = debut; m < fin; m++) {
      collectee += collecteeMensuelle[m] ?? 0;
      dedBS += deductibleBiensServices[m] ?? 0;
      dedImmo += deductibleImmobilisations[m] ?? 0;
    }
    collectee = euro(collectee);
    dedBS = euro(dedBS);
    dedImmo = euro(dedImmo);

    const solde = euro(collectee - dedBS - dedImmo);
    const apresCredit = euro(solde - credit);

    let aDecaisser = 0;
    let creditReporte = 0;
    if (apresCredit >= 0) {
      aDecaisser = apresCredit;
      credit = 0;
    } else if (parametres.tva.creditReportable) {
      creditReporte = euro(-apresCredit);
      credit = creditReporte;
    } else {
      // Crédit remboursé : encaissement au même rythme qu'un décaissement de TVA.
      const moisRemboursement = Math.min(fin - 1 + decalage, horizon - 1);
      resultat.remboursements[moisRemboursement] += euro(-apresCredit);
      credit = 0;
    }

    const dernierMois = fin - 1;
    const moisDecaissement = Math.min(dernierMois + decalage, horizon - 1);
    if (aDecaisser > 0) resultat.decaissements[moisDecaissement] += aDecaisser;

    const exercice = exercicePourMois(exercices, dernierMois);
    if (exercice >= 0) {
      resultat.parExercice[exercice].collectee = euro(
        resultat.parExercice[exercice].collectee + collectee,
      );
      resultat.parExercice[exercice].deductible = euro(
        resultat.parExercice[exercice].deductible + dedBS + dedImmo,
      );
      resultat.parExercice[exercice].due = euro(resultat.parExercice[exercice].due + solde);
    }

    resultat.periodes.push({
      moisAbsolu: dernierMois,
      exercice,
      libelle: libelles[dernierMois] ?? '',
      collectee,
      deductibleBiensServices: dedBS,
      deductibleImmobilisations: dedImmo,
      solde,
      creditReporte,
      aDecaisser,
      moisDecaissement,
    });
  }

  // Position de TVA à chaque clôture : déclarations émises moins règlements effectués.
  for (let i = 0; i < n; i++) {
    const fin = exercices[i].moisDebutAbsolu + exercices[i].nbMois;
    let dues = 0;
    let reglees = 0;
    for (const p of resultat.periodes) {
      if (p.moisAbsolu < fin) dues += p.aDecaisser;
    }
    for (let m = 0; m < fin; m++) reglees += resultat.decaissements[m] ?? 0;
    resultat.dueParExercice[i] = euro(Math.max(0, dues - reglees));

    const derniere = [...resultat.periodes].reverse().find((p) => p.moisAbsolu < fin);
    resultat.creditParExercice[i] = derniere ? derniere.creditReporte : 0;
  }

  return resultat;
}

/**
 * Impôt sur les sociétés d'un exercice, après imputation des déficits reportables.
 *
 * Renvoie l'impôt dû et le stock de déficit restant à reporter sur les exercices
 * suivants. Le report est illimité dans le temps ; le plafonnement d'imputation des
 * grands déficits n'est pas retenu, sans objet à l'échelle des dossiers du cabinet.
 */
export function impotSocietes(
  resultatFiscal: number,
  deficitReportable: number,
  parametres: Parametres,
): { impot: number; deficitRestant: number; baseImposable: number } {
  if (resultatFiscal <= 0) {
    return {
      impot: 0,
      deficitRestant: euro(deficitReportable - resultatFiscal),
      baseImposable: 0,
    };
  }

  const imputation = Math.min(deficitReportable, resultatFiscal);
  const base = euro(resultatFiscal - imputation);
  const deficitRestant = euro(deficitReportable - imputation);

  const is = parametres.is;
  let impot: number;
  if (is.eligibleTauxReduit) {
    const fractionReduite = Math.min(base, is.plafondTauxReduit);
    const fractionNormale = Math.max(0, base - is.plafondTauxReduit);
    impot = euro(fractionReduite * pct(is.tauxReduit) + fractionNormale * pct(is.tauxNormal));
  } else {
    impot = euro(base * pct(is.tauxNormal));
  }

  return { impot, deficitRestant, baseImposable: base };
}

/**
 * Cotisations sociales de l'exploitant d'un BNC ou d'un BIC à l'impôt sur le revenu.
 *
 * L'assiette est le bénéfice après déduction des cotisations elles-mêmes, ce qui est
 * circulaire. En notant R le résultat avant cotisations et t le taux, la cotisation C
 * vérifie C = t × (R − C), donc C = t × R / (1 + t). La résolution est exacte : aucune
 * itération n'est nécessaire.
 */
export function cotisationsExploitant(
  resultatAvantCotisations: number,
  parametres: Parametres,
  tauxPourcent?: number,
): number {
  const taux = pct(tauxPourcent ?? parametres.tns.tauxCotisations);
  if (taux <= 0) return Math.max(0, parametres.tns.cotisationsMinimales);

  const base = parametres.tns.assietteResultatAvantCotisations
    ? resultatAvantCotisations / (1 + taux)
    : resultatAvantCotisations;

  const cotisations = euro(Math.max(0, base) * taux);
  return Math.max(cotisations, parametres.tns.cotisationsMinimales);
}

/**
 * Échéancier de décaissement de l'impôt sur les sociétés : solde payé après la clôture,
 * complété d'acomptes trimestriels lorsque le dossier en prévoit.
 */
export function echeancierImpot(
  impotParExercice: readonly number[],
  exercices: readonly Exercice[],
  parametres: Parametres,
): number[] {
  const horizon = nbMoisTotal(exercices);
  const flux = zeros(horizon);

  for (let i = 0; i < exercices.length; i++) {
    const impot = impotParExercice[i] ?? 0;
    if (impot <= 0) continue;
    const e = exercices[i];
    const cloture = e.moisDebutAbsolu + e.nbMois - 1;

    // Les acomptes de l'exercice N sont assis sur le résultat de l'exercice N−1.
    const acomptesPossibles = parametres.is.acomptes && i > 0 && (impotParExercice[i - 1] ?? 0) > 0;
    const baseAcomptes = acomptesPossibles ? (impotParExercice[i - 1] ?? 0) : 0;
    const acompte = euro(baseAcomptes / 4);

    let verse = 0;
    if (acomptesPossibles) {
      for (let k = 1; k <= 4; k++) {
        const m = e.moisDebutAbsolu + k * 3 - 1;
        if (m < horizon) {
          flux[m] += acompte;
          verse += acompte;
        }
      }
    }

    const solde = euro(impot - verse);
    const moisSolde = cloture + parametres.is.decalagePaiementMois;
    if (moisSolde < horizon) flux[moisSolde] += solde;
  }

  return flux;
}

import type { CreditBail, Emprunt, PeriodiciteEmprunt } from '../model/financements.js';
import type { Dossier } from '../model/dossier.js';
import { exercicePourMois, moisAbsolu, nbMoisTotal } from './periodes.js';
import type { AmortissementEmprunt, EcheanceEmprunt, Exercice } from './types.js';
import { euro, pct, zeros } from './utils.js';

/** Nombre de mois séparant deux échéances. */
function moisParPeriode(periodicite: PeriodiciteEmprunt): number {
  return periodicite === 'mensuelle' ? 1 : periodicite === 'trimestrielle' ? 3 : 12;
}

/**
 * Tableau d'amortissement d'un emprunt à échéances constantes.
 *
 * Une ligne est produite par échéance, à la date de son règlement. L'assurance est
 * calculée mois par mois puis cumulée sur la période, comme le fait une banque qui
 * la prélève avec la mensualité.
 *
 * Différé partiel : seuls les intérêts sont réglés pendant la franchise.
 * Différé total : rien n'est réglé et les intérêts sont capitalisés — la ligne porte
 * alors un capital négatif, qui traduit l'augmentation du capital restant dû.
 */
export function tableauAmortissement(
  emprunt: Emprunt,
  exercices: readonly Exercice[],
): AmortissementEmprunt {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const parExercice = Array.from({ length: n }, () => ({
    interets: 0,
    capital: 0,
    assurance: 0,
    capitalRestantDuFin: 0,
  }));

  const vide: AmortissementEmprunt = {
    empruntId: emprunt.id,
    libelle: emprunt.libelle,
    montant: emprunt.montant,
    tauxAnnuel: emprunt.tauxAnnuel,
    dureeMois: emprunt.dureeMois,
    mensualite: 0,
    echeances: [],
    parExercice,
  };
  if (!emprunt.actif || emprunt.montant <= 0 || emprunt.dureeMois <= 0) return vide;

  const p = moisParPeriode(emprunt.periodicite);
  const tauxPeriode = pct(emprunt.tauxAnnuel) * (p / 12);
  const nbPeriodes = Math.ceil(emprunt.dureeMois / p);
  const differe = emprunt.typeDiffere === 'aucun' ? 0 : emprunt.differeMois;
  const nbPeriodesDiffere = Math.min(Math.floor(differe / p), Math.max(nbPeriodes - 1, 0));
  const nbPeriodesAmort = Math.max(nbPeriodes - nbPeriodesDiffere, 1);

  const debut = moisAbsolu(exercices, emprunt.exerciceDeblocage, emprunt.moisDeblocage);
  const tauxAssuranceMensuel = pct(emprunt.tauxAssuranceAnnuel) / 12;

  // Capital sur lequel portera l'amortissement, après capitalisation éventuelle.
  let capital = emprunt.montant;
  if (emprunt.typeDiffere === 'total' && nbPeriodesDiffere > 0) {
    capital = euro(emprunt.montant * Math.pow(1 + tauxPeriode, nbPeriodesDiffere));
  }

  const mensualite =
    tauxPeriode === 0
      ? euro(capital / nbPeriodesAmort)
      : euro((capital * tauxPeriode) / (1 - Math.pow(1 + tauxPeriode, -nbPeriodesAmort)));

  const echeances: EcheanceEmprunt[] = [];
  let crd = emprunt.montant;

  for (let k = 1; k <= nbPeriodes; k++) {
    const mois = debut + k * p;
    if (mois >= horizon) break;

    const capitalDebut = crd;
    const interets = euro(crd * tauxPeriode);
    const assiette = emprunt.assuranceSurCapitalRestant ? crd : emprunt.montant;
    const assurance = euro(assiette * tauxAssuranceMensuel * p);

    let partCapital: number;
    let echeance: number;

    if (k <= nbPeriodesDiffere) {
      if (emprunt.typeDiffere === 'total') {
        // Intérêts non réglés : ils grossissent le capital restant dû.
        partCapital = euro(-interets);
        echeance = 0;
      } else {
        partCapital = 0;
        echeance = interets;
      }
    } else {
      const derniere = k === nbPeriodes;
      partCapital = derniere ? crd : euro(mensualite - interets);
      if (partCapital > crd) partCapital = crd;
      echeance = euro(interets + partCapital);
    }

    crd = euro(crd - partCapital);
    const exercice = exercicePourMois(exercices, mois);

    echeances.push({
      moisAbsolu: mois,
      exercice,
      capitalDebut,
      echeance,
      interets,
      capital: partCapital,
      assurance,
      capitalRestantDu: crd,
    });

    if (exercice >= 0) {
      parExercice[exercice].interets = euro(parExercice[exercice].interets + interets);
      parExercice[exercice].capital = euro(parExercice[exercice].capital + partCapital);
      parExercice[exercice].assurance = euro(parExercice[exercice].assurance + assurance);
    }
  }

  // Capital restant dû à chaque clôture, y compris sur les exercices sans échéance.
  let courant = emprunt.montant;
  const dejaDebloque = (i: number) => i >= emprunt.exerciceDeblocage;
  for (let i = 0; i < n; i++) {
    courant = euro(courant - parExercice[i].capital);
    parExercice[i].capitalRestantDuFin = dejaDebloque(i) ? Math.max(0, courant) : 0;
  }

  return { ...vide, mensualite, echeances, parExercice };
}

export interface FluxEmprunts {
  /** Capital débloqué encaissé, par mois absolu. */
  deblocages: number[];
  /** Échéances réglées (capital + intérêts) et assurance, par mois absolu. */
  echeances: number[];
  /** Frais de dossier et de garantie décaissés, par mois absolu. */
  frais: number[];
  /** Intérêts et assurance constatés en charge, par exercice. */
  chargesFinancieres: number[];
  /** Frais de dossier et de garantie constatés en charge, par exercice. */
  fraisParExercice: number[];
  /** Capital remboursé par exercice. */
  capitalRembourse: number[];
  /** Capital restant dû à chaque clôture, tous emprunts confondus. */
  capitalRestantDu: number[];
  /** Capital débloqué par exercice. */
  deblocagesParExercice: number[];
}

/** Agrège les flux de tous les emprunts du dossier. */
export function calculerFluxEmprunts(
  dossier: Dossier,
  exercices: readonly Exercice[],
  tableaux: readonly AmortissementEmprunt[],
): FluxEmprunts {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const flux: FluxEmprunts = {
    deblocages: zeros(horizon),
    echeances: zeros(horizon),
    frais: zeros(horizon),
    chargesFinancieres: zeros(n),
    fraisParExercice: zeros(n),
    capitalRembourse: zeros(n),
    capitalRestantDu: zeros(n),
    deblocagesParExercice: zeros(n),
  };

  const parId = new Map(tableaux.map((t) => [t.empruntId, t]));

  for (const emprunt of dossier.financements.emprunts) {
    if (!emprunt.actif || emprunt.montant <= 0) continue;
    const mois = moisAbsolu(exercices, emprunt.exerciceDeblocage, emprunt.moisDeblocage);
    if (mois < horizon) {
      flux.deblocages[mois] += emprunt.montant;
      const frais = euro(emprunt.fraisDossier + emprunt.fraisGarantie);
      if (frais > 0) flux.frais[mois] += frais;
    }
    flux.deblocagesParExercice[emprunt.exerciceDeblocage] += emprunt.montant;
    flux.fraisParExercice[emprunt.exerciceDeblocage] += euro(
      emprunt.fraisDossier + emprunt.fraisGarantie,
    );

    const tableau = parId.get(emprunt.id);
    if (!tableau) continue;
    for (const e of tableau.echeances) {
      if (e.moisAbsolu < horizon) flux.echeances[e.moisAbsolu] += euro(e.echeance + e.assurance);
    }
    for (let i = 0; i < n; i++) {
      flux.chargesFinancieres[i] += tableau.parExercice[i].interets + tableau.parExercice[i].assurance;
      flux.capitalRembourse[i] += tableau.parExercice[i].capital;
      flux.capitalRestantDu[i] += tableau.parExercice[i].capitalRestantDuFin;
    }
  }

  flux.chargesFinancieres = flux.chargesFinancieres.map(euro);
  flux.capitalRembourse = flux.capitalRembourse.map(euro);
  flux.capitalRestantDu = flux.capitalRestantDu.map(euro);
  return flux;
}

export interface FluxCreditsBaux {
  /** Loyers HT constatés en charge, par mois absolu. */
  loyersHT: number[];
  /** TVA déductible sur les loyers, par mois absolu. */
  tvaDeductible: number[];
  /** Loyers TTC décaissés, par mois absolu. */
  loyersTTC: number[];
  /** Loyers HT par exercice, à porter en services extérieurs. */
  loyersParExercice: number[];
  /** Dépôts de garantie versés puis restitués, par mois absolu (signe : positif = sortie). */
  depots: number[];
  /** Dépôts de garantie immobilisés à chaque clôture. */
  depotsImmobilises: number[];
  /** Levées d'option décaissées, par mois absolu. */
  levees: number[];
  /** Valeur brute des biens acquis par levée d'option, cumulée par exercice. */
  leveesCumulees: number[];
}

/**
 * Crédit-bail et location financière : le bien ne figure pas à l'actif, seul le loyer
 * est une charge. Le dépôt de garantie est une créance immobilisée, restituée en fin
 * de contrat ; la levée d'option fait entrer le bien à l'actif à sa valeur résiduelle.
 */
export function calculerCreditsBaux(
  dossier: Dossier,
  exercices: readonly Exercice[],
): FluxCreditsBaux {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const flux: FluxCreditsBaux = {
    loyersHT: zeros(horizon),
    tvaDeductible: zeros(horizon),
    loyersTTC: zeros(horizon),
    loyersParExercice: zeros(n),
    depots: zeros(horizon),
    depotsImmobilises: zeros(n),
    levees: zeros(horizon),
    leveesCumulees: zeros(n),
  };

  const assujetti = dossier.parametres.tva.assujetti;

  for (const cb of dossier.financements.creditsBaux as CreditBail[]) {
    if (!cb.actif || cb.loyerMensuelHT <= 0) continue;
    const debut = moisAbsolu(exercices, cb.exerciceDebut, cb.moisDebut);
    const tvaLoyer = assujetti ? euro(cb.loyerMensuelHT * pct(cb.tauxTva)) : 0;

    for (let k = 0; k < cb.dureeMois; k++) {
      const m = debut + k;
      if (m >= horizon) break;
      flux.loyersHT[m] += cb.loyerMensuelHT;
      flux.tvaDeductible[m] += tvaLoyer;
      flux.loyersTTC[m] += euro(cb.loyerMensuelHT + tvaLoyer);
      const ex = exercicePourMois(exercices, m);
      if (ex >= 0) flux.loyersParExercice[ex] += cb.loyerMensuelHT;
    }

    if (cb.depotGarantie > 0 && debut < horizon) {
      flux.depots[debut] += cb.depotGarantie;
      const fin = debut + cb.dureeMois;
      if (fin < horizon) flux.depots[fin] -= cb.depotGarantie;
      for (let i = 0; i < n; i++) {
        const e = exercices[i];
        const cloture = e.moisDebutAbsolu + e.nbMois - 1;
        if (cloture >= debut && cloture < fin) flux.depotsImmobilises[i] += cb.depotGarantie;
      }
    }

    if (cb.valeurResiduelle > 0) {
      const levee = debut + cb.dureeMois;
      if (levee < horizon) {
        flux.levees[levee] += cb.valeurResiduelle;
        const ex = exercicePourMois(exercices, levee);
        for (let i = Math.max(ex, 0); i < n; i++) flux.leveesCumulees[i] += cb.valeurResiduelle;
      }
    }
  }

  return flux;
}

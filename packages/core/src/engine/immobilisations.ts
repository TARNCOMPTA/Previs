import type { Cession, LigneInvestissement } from '../model/investissements.js';
import type { Dossier } from '../model/dossier.js';
import { moisAbsoluDansHorizon, nbMoisTotal } from './periodes.js';
import type { AmortissementImmobilisation, Exercice } from './types.js';
import { euro, pct, repartirEgal, zeros } from './utils.js';

/** Catégories qui ne s'amortissent jamais, quel que soit le mode saisi. */
const NON_AMORTISSABLES = new Set(['financier', 'stock_initial', 'tresorerie_demarrage']);

/**
 * La trésorerie de démarrage n'est pas une dépense : c'est un matelas de trésorerie
 * conservé au bilan. Elle est donc exclue des décaissements et du plan de financement,
 * où elle apparaîtrait sinon deux fois — une fois en besoin, une fois en disponibilités.
 */
export function estDepense(ligne: LigneInvestissement): boolean {
  return ligne.categorie !== 'tresorerie_demarrage';
}

/** Coefficient d'amortissement dégressif applicable selon la durée d'usage. */
function coefficientDegressif(dureeAnnees: number): number {
  if (dureeAnnees <= 4) return 1.25;
  if (dureeAnnees <= 6) return 1.75;
  return 2.25;
}

/**
 * Plan d'amortissement d'une immobilisation, annuité par annuité alignée sur les
 * exercices du prévisionnel.
 *
 * Le prorata de la première annuité se compte en mois entiers à partir du mois
 * d'acquisition, conformément à l'usage fiscal. En mode dégressif, le taux bascule
 * automatiquement sur le linéaire résiduel dès que celui-ci devient plus favorable.
 */
export function planAmortissement(
  ligne: LigneInvestissement,
  exercices: readonly Exercice[],
): AmortissementImmobilisation {
  const n = exercices.length;
  const dotations = zeros(n);
  const cumules = zeros(n);
  const vnc = zeros(n);

  const base = Math.max(0, euro(ligne.montantHT - ligne.valeurResiduelle));
  const amortissable =
    ligne.modeAmortissement !== 'aucun' &&
    !NON_AMORTISSABLES.has(ligne.categorie) &&
    ligne.dureeAmortissementAnnees > 0 &&
    base > 0;

  if (!amortissable) {
    for (let i = 0; i < n; i++) vnc[i] = i >= ligne.exercice ? ligne.montantHT : 0;
    return {
      investissementId: ligne.id,
      libelle: ligne.libelle,
      categorie: ligne.categorie,
      base,
      dureeAnnees: ligne.dureeAmortissementAnnees,
      dotations,
      cumules,
      vnc,
    };
  }

  const duree = ligne.dureeAmortissementAnnees;
  const coef = ligne.modeAmortissement === 'degressif' ? coefficientDegressif(duree) : 1;
  const tauxDegressif = (1 / duree) * coef;

  let residuelle = base;
  let anneesConsommees = 0;

  for (let i = 0; i < n; i++) {
    const e = exercices[i];
    if (i < ligne.exercice || residuelle <= 0) {
      cumules[i] = euro(base - residuelle);
      vnc[i] = euro(ligne.montantHT - cumules[i]);
      continue;
    }

    // Sur l'exercice d'acquisition, seuls les mois postérieurs à l'entrée du bien comptent.
    const moisAmortis =
      i === ligne.exercice ? Math.max(0, e.nbMois - Math.min(ligne.mois, e.nbMois) + 1) : e.nbMois;

    const dureeRestante = Math.max(duree - anneesConsommees, 1 / 12);
    const taux =
      ligne.modeAmortissement === 'degressif'
        ? Math.max(tauxDegressif, 1 / dureeRestante)
        : 1 / duree;

    const dotation = Math.min(residuelle, euro(residuelle * taux * (moisAmortis / 12)));
    dotations[i] = dotation;
    residuelle = euro(residuelle - dotation);
    anneesConsommees += moisAmortis / 12;

    cumules[i] = euro(base - residuelle);
    vnc[i] = euro(ligne.montantHT - cumules[i]);
  }

  return {
    investissementId: ligne.id,
    libelle: ligne.libelle,
    categorie: ligne.categorie,
    base,
    dureeAnnees: duree,
    dotations,
    cumules,
    vnc,
  };
}

export interface FluxInvestissements {
  /** Montant HT engagé, par mois absolu. */
  engageHT: number[];
  /** TVA récupérable sur immobilisations, par mois absolu. */
  tvaRecuperable: number[];
  /** Montant TTC engagé, par mois absolu. */
  engageTTC: number[];
  /** Montant TTC effectivement décaissé, par mois absolu (échelonnement pris en compte). */
  decaisseTTC: number[];
  /** Total HT investi par exercice, hors trésorerie de démarrage. */
  totalParExercice: number[];
  /** Trésorerie de démarrage prévue par exercice, présentée à part. */
  tresorerieDemarrage: number[];
  /** Stock de départ acquis par exercice, qui vient alimenter le stock au bilan. */
  stockInitial: number[];
  /** Valeur brute des immobilisations à l'actif, par nature et par exercice. */
  brutesParNature: {
    incorporelles: number[];
    corporelles: number[];
    financieres: number[];
  };
}

/** Ventile les investissements en flux mensuels d'engagement et de décaissement. */
export function calculerFluxInvestissements(
  dossier: Dossier,
  exercices: readonly Exercice[],
): FluxInvestissements {
  const total = nbMoisTotal(exercices);
  const n = exercices.length;
  const flux: FluxInvestissements = {
    engageHT: zeros(total),
    tvaRecuperable: zeros(total),
    engageTTC: zeros(total),
    decaisseTTC: zeros(total),
    totalParExercice: zeros(n),
    tresorerieDemarrage: zeros(n),
    stockInitial: zeros(n),
    brutesParNature: { incorporelles: zeros(n), corporelles: zeros(n), financieres: zeros(n) },
  };

  const assujetti = dossier.parametres.tva.assujetti;

  for (const ligne of dossier.investissements.lignes) {
    if (!ligne.actif || ligne.montantHT === 0) continue;
    // Une ligne datée hors de l'horizon ne produit rien : ni décaissement, ni immobilisation.
    // Le contrôle « lignes_hors_horizon » la signale, elle ne disparaît pas en silence.
    const debut = moisAbsoluDansHorizon(exercices, ligne.exercice, ligne.mois);
    if (debut === null) continue;
    const tva = assujetti && ligne.tvaRecuperable ? euro(ligne.montantHT * pct(ligne.tauxTva)) : 0;
    const ttc = euro(ligne.montantHT + tva);

    if (ligne.categorie === 'tresorerie_demarrage') {
      flux.tresorerieDemarrage[ligne.exercice] += ligne.montantHT;
      continue;
    }

    flux.engageHT[debut] += ligne.montantHT;
    flux.tvaRecuperable[debut] += tva;
    flux.engageTTC[debut] += ttc;

    const parts = repartirEgal(ttc, ligne.echelonnementMois);
    for (let k = 0; k < parts.length; k++) {
      const m = debut + k;
      if (m < total) flux.decaisseTTC[m] += parts[k];
    }

    if (ligne.categorie === 'stock_initial') {
      flux.stockInitial[ligne.exercice] += ligne.montantHT;
      continue;
    }

    flux.totalParExercice[ligne.exercice] += ligne.montantHT;

    // Les valeurs brutes se cumulent d'un exercice à l'autre : le bien reste à l'actif.
    const cible =
      ligne.categorie === 'incorporel' || ligne.categorie === 'frais_etablissement'
        ? flux.brutesParNature.incorporelles
        : ligne.categorie === 'financier'
          ? flux.brutesParNature.financieres
          : flux.brutesParNature.corporelles;
    for (let i = ligne.exercice; i < n; i++) cible[i] += ligne.montantHT;
  }

  return flux;
}

export interface FluxCessions {
  /** Prix de cession TTC encaissé, par mois absolu. */
  encaisseTTC: number[];
  /** TVA collectée sur les cessions, par mois absolu. */
  tvaCollectee: number[];
  /** Prix de cession HT par exercice. */
  prixParExercice: number[];
  /** Valeur nette comptable sortie de l'actif, par exercice. */
  vncParExercice: number[];
  /** Plus ou moins-value de cession, par exercice. */
  plusValuesParExercice: number[];
  /** Valeur brute sortie de l'actif, par exercice cumulé. */
  brutSortiCumule: number[];
  /** Amortissements cumulés sortis de l'actif, par exercice cumulé. */
  amortSortiCumule: number[];
}

/**
 * Cessions d'immobilisations : encaissement du prix, sortie de l'actif à la valeur
 * brute et des amortissements pratiqués, et constatation de la plus ou moins-value.
 */
export function calculerCessions(
  dossier: Dossier,
  exercices: readonly Exercice[],
  plans: readonly AmortissementImmobilisation[],
): FluxCessions {
  const total = nbMoisTotal(exercices);
  const n = exercices.length;
  const flux: FluxCessions = {
    encaisseTTC: zeros(total),
    tvaCollectee: zeros(total),
    prixParExercice: zeros(n),
    vncParExercice: zeros(n),
    plusValuesParExercice: zeros(n),
    brutSortiCumule: zeros(n),
    amortSortiCumule: zeros(n),
  };

  const assujetti = dossier.parametres.tva.assujetti;
  const parId = new Map(plans.map((p) => [p.investissementId, p]));
  const lignesParId = new Map(dossier.investissements.lignes.map((l) => [l.id, l]));

  for (const cession of dossier.investissements.cessions as Cession[]) {
    if (!cession.actif || cession.prixCessionHT === 0) continue;
    /*
     * Le cas qui déséquilibrait le bilan : une cession datée de l'exercice 2 dans un dossier
     * réduit à un exercice voyait son prix encaissé sur l'exercice 0 — « moisAbsolu » ramenait
     * l'index — tandis que « prixParExercice[2] » d'un tableau de longueur 1 était perdu. La
     * trésorerie montait de 10 800 €, le produit exceptionnel n'existait pas, et l'actif ne
     * retrouvait plus son passif, à 9 000 € près.
     */
    const mois = moisAbsoluDansHorizon(exercices, cession.exercice, cession.mois);
    if (mois === null) continue;
    const tva = assujetti ? euro(cession.prixCessionHT * pct(cession.tauxTva)) : 0;

    flux.encaisseTTC[mois] += euro(cession.prixCessionHT + tva);
    flux.tvaCollectee[mois] += tva;
    flux.prixParExercice[cession.exercice] += cession.prixCessionHT;

    const plan = cession.investissementId ? parId.get(cession.investissementId) : undefined;
    const ligne = cession.investissementId ? lignesParId.get(cession.investissementId) : undefined;

    // La valeur nette comptable est celle de la clôture précédente : le bien cédé en
    // cours d'exercice n'est plus amorti sur l'exercice de sortie.
    const cumulPrecedent = plan ? (cession.exercice > 0 ? plan.cumules[cession.exercice - 1] : 0) : 0;
    const brut = ligne?.montantHT ?? 0;
    const vnc = cession.vncForcee ?? euro(brut - cumulPrecedent);

    flux.vncParExercice[cession.exercice] += vnc;
    flux.plusValuesParExercice[cession.exercice] += euro(cession.prixCessionHT - vnc);

    for (let i = cession.exercice; i < n; i++) {
      flux.brutSortiCumule[i] += brut;
      flux.amortSortiCumule[i] += cumulPrecedent;
    }
  }

  return flux;
}

/** Dotations aux amortissements agrégées par exercice. */
export function dotationsParExercice(
  plans: readonly AmortissementImmobilisation[],
  nbExercices: number,
): number[] {
  const t = zeros(nbExercices);
  for (const p of plans) for (let i = 0; i < nbExercices; i++) t[i] += p.dotations[i] ?? 0;
  return t.map(euro);
}

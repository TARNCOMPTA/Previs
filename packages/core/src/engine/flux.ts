import { estAchatConsomme, type LigneCharge, type LignePersonnel } from '../model/charges.js';
import type { Dossier } from '../model/dossier.js';
import { estMarchandise, type LigneRecette } from '../model/recettes.js';
import { moisAbsoluDansHorizon, nbMoisTotal } from './periodes.js';
import { decalerSerie, repartirSurCalendrier, totauxAnnuelsDepuisRepartition } from './repartition.js';
import type { DetailCharge, DetailPersonnel, DetailRecette, Exercice } from './types.js';
import { euro, pct, val, zeros } from './utils.js';

/**
 * Un poste de tiers : ce qui a été engagé et ce qui a été réglé, mois par mois.
 *
 * Le solde du compte à une clôture vaut toujours « cumul engagé − cumul réglé ».
 * C'est cette égalité, et non un calcul séparé de créances et de dettes, qui garantit
 * l'équilibre du bilan : aucun montant ne peut apparaître d'un seul côté.
 */
export interface Poste {
  engage: number[];
  regle: number[];
}

export function posteVide(horizon: number): Poste {
  return { engage: zeros(horizon), regle: zeros(horizon) };
}

/** Solde du compte à la clôture de l'exercice : ce qui reste à encaisser ou à payer. */
export function encoursCloture(poste: Poste, exercice: Exercice): number {
  const fin = exercice.moisDebutAbsolu + exercice.nbMois;
  let engage = 0;
  let regle = 0;
  for (let m = 0; m < fin; m++) {
    engage += poste.engage[m] ?? 0;
    regle += poste.regle[m] ?? 0;
  }
  return euro(engage - regle);
}

/** Ajoute une série à une autre, en place. */
function cumuler(cible: number[], source: readonly number[], signe = 1): void {
  for (let m = 0; m < cible.length; m++) cible[m] += (source[m] ?? 0) * signe;
}

// ─── Recettes ─────────────────────────────────────────────────────────────────

export interface ResultatRecettes {
  detail: DetailRecette[];
  /** Chiffre d'affaires HT par exercice, toutes lignes confondues. */
  caParExercice: number[];
  caMensuel: number[];
  /** Ventes de marchandises HT par exercice, pour la marge commerciale. */
  marchandisesParExercice: number[];
  /** Production vendue HT par exercice. */
  productionParExercice: number[];
  /** Subventions d'exploitation par exercice — un produit, pas du chiffre d'affaires. */
  subventionsExploitation: number[];
  /** Autres produits de gestion courante par exercice. */
  autresProduits: number[];
  /** TVA collectée par mois absolu. */
  tvaCollectee: number[];
  /** Compte clients : produits TTC engagés et encaissés. */
  clients: Poste;
  /** Achats induits par un taux d'achats liés, HT par exercice. */
  achatsLiesParExercice: number[];
  /** Achats induits, HT par mois absolu. */
  achatsLiesMensuel: number[];
  /** TVA déductible sur les achats induits, par mois absolu. */
  achatsLiesTva: number[];
}

/** Résout le chiffre d'affaires HT d'une ligne de recette selon son mode de saisie. */
export function chiffreAffairesLigne(ligne: LigneRecette, nbExercices: number): number[] {
  const t = zeros(nbExercices);
  switch (ligne.mode) {
    case 'montants':
      for (let i = 0; i < nbExercices; i++) t[i] = val(ligne.montants, i);
      break;
    case 'croissance': {
      let courant = ligne.base;
      for (let i = 0; i < nbExercices; i++) {
        if (i > 0) courant = courant * (1 + pct(val(ligne.tauxCroissance, i)));
        t[i] = euro(courant);
      }
      break;
    }
    case 'volume_prix':
      for (let i = 0; i < nbExercices; i++) {
        t[i] = euro(val(ligne.quantites, i) * val(ligne.prixUnitaire, i));
      }
      break;
    case 'capacite':
      for (let i = 0; i < nbExercices; i++) {
        t[i] = euro(
          val(ligne.quantites, i) * val(ligne.prixUnitaire, i) * pct(val(ligne.tauxRemplissage, i)),
        );
      }
      break;
  }
  return t;
}

export function calculerRecettes(dossier: Dossier, exercices: readonly Exercice[]): ResultatRecettes {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const p = dossier.parametres;
  const assujetti = p.tva.assujetti;

  const r: ResultatRecettes = {
    detail: [],
    caParExercice: zeros(n),
    caMensuel: zeros(horizon),
    marchandisesParExercice: zeros(n),
    productionParExercice: zeros(n),
    subventionsExploitation: zeros(n),
    autresProduits: zeros(n),
    tvaCollectee: zeros(horizon),
    clients: posteVide(horizon),
    achatsLiesParExercice: zeros(n),
    achatsLiesMensuel: zeros(horizon),
    achatsLiesTva: zeros(horizon),
  };

  const partComptant = Math.min(1, Math.max(0, pct(p.bfr.partComptantPourcent)));

  for (const ligne of dossier.recettes.lignes) {
    if (!ligne.actif) continue;

    const brut = chiffreAffairesLigne(ligne, n);
    const montants = totauxAnnuelsDepuisRepartition(brut, ligne.repartition, exercices);
    const mensuel = repartirSurCalendrier(montants, ligne.repartition, exercices);

    const taux = assujetti ? ligne.tauxTva : 0;
    const tvaMensuelle = mensuel.map((v) => euro(v * pct(taux)));
    const ttc = mensuel.map((v, m) => euro(v + tvaMensuelle[m]));

    // Encaissement : la part comptant tombe le mois même, le solde suit le délai client.
    const delai = ligne.delaiEncaissementJours ?? p.bfr.delaiClientsJours;
    const differe = ttc.map((v) => euro(v * (1 - partComptant)));
    const comptant = ttc.map((v) => euro(v * partComptant));
    const encaisse = decalerSerie(differe, delai, horizon).map((v, m) => euro(v + comptant[m]));

    cumuler(r.clients.engage, ttc);
    cumuler(r.clients.regle, encaisse);
    cumuler(r.tvaCollectee, tvaMensuelle);

    if (ligne.nature === 'subvention_exploitation') {
      for (let i = 0; i < n; i++) r.subventionsExploitation[i] += montants[i];
    } else if (ligne.nature === 'autres_produits') {
      for (let i = 0; i < n; i++) r.autresProduits[i] += montants[i];
    } else {
      for (let i = 0; i < n; i++) {
        r.caParExercice[i] += montants[i];
        if (estMarchandise(ligne.nature)) r.marchandisesParExercice[i] += montants[i];
        else r.productionParExercice[i] += montants[i];
      }
      cumuler(r.caMensuel, mensuel);
    }

    // Achats induits : négoce et restauration, où le coût d'achat suit mécaniquement la vente.
    if (ligne.tauxAchatsLiesPourcent > 0) {
      const tauxAchat = pct(ligne.tauxAchatsLiesPourcent);
      for (let i = 0; i < n; i++) r.achatsLiesParExercice[i] += euro(montants[i] * tauxAchat);
      for (let m = 0; m < horizon; m++) {
        const achat = euro(mensuel[m] * tauxAchat);
        r.achatsLiesMensuel[m] += achat;
        r.achatsLiesTva[m] += assujetti ? euro(achat * pct(ligne.tauxTva)) : 0;
      }
    }

    r.detail.push({
      ligneId: ligne.id,
      libelle: ligne.libelle,
      nature: ligne.nature,
      montants,
      mensuel,
      tauxTva: taux,
    });
  }

  r.caParExercice = r.caParExercice.map(euro);
  return r;
}

// ─── Charges d'exploitation ───────────────────────────────────────────────────

export interface ResultatCharges {
  detail: DetailCharge[];
  /** Total HT par catégorie et par exercice. */
  parCategorie: Record<string, number[]>;
  /** Achats de marchandises et de matières, HT par exercice (avant variation de stock). */
  achatsConsommables: number[];
  /** Charges fixes HT par exercice, pour le seuil de rentabilité. */
  fixesParExercice: number[];
  /** Charges variables HT par exercice. */
  variablesParExercice: number[];
  /** Total HT par exercice. */
  totalParExercice: number[];
  /** TVA déductible sur biens et services, par mois absolu. */
  tvaDeductible: number[];
  /** Compte fournisseurs : charges TTC engagées et réglées. */
  fournisseurs: Poste;
}

const CATEGORIES: string[] = [
  'achats_marchandises',
  'achats_matieres',
  'fournitures',
  'sous_traitance',
  'services_exterieurs',
  'autres_services_exterieurs',
  'impots_taxes',
  'autres_charges',
  'charges_financieres',
];

/**
 * Charges d'exploitation. Le paramètre `caParExercice` sert aux lignes saisies en
 * pourcentage du chiffre d'affaires ; les loyers de crédit-bail et les achats induits
 * par les recettes sont injectés en supplément, car ils suivent les mêmes règles de
 * TVA et de délai de règlement que les autres charges.
 */
export function calculerCharges(
  dossier: Dossier,
  exercices: readonly Exercice[],
  caParExercice: readonly number[],
  supplements: {
    achatsLiesMensuel: readonly number[];
    achatsLiesParExercice: readonly number[];
    achatsLiesTva: readonly number[];
    loyersCreditBailMensuel: readonly number[];
    loyersCreditBailParExercice: readonly number[];
    tvaCreditBail: readonly number[];
  },
): ResultatCharges {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const p = dossier.parametres;
  const assujetti = p.tva.assujetti;

  const parCategorie: Record<string, number[]> = {};
  for (const c of CATEGORIES) parCategorie[c] = zeros(n);

  const r: ResultatCharges = {
    detail: [],
    parCategorie,
    achatsConsommables: zeros(n),
    fixesParExercice: zeros(n),
    variablesParExercice: zeros(n),
    totalParExercice: zeros(n),
    tvaDeductible: zeros(horizon),
    fournisseurs: posteVide(horizon),
  };

  const enregistrer = (
    categorie: string,
    montants: readonly number[],
    mensuel: readonly number[],
    tva: readonly number[],
    delaiJours: number,
    fixe: boolean,
  ) => {
    const ttc = mensuel.map((v, m) => euro(v + (tva[m] ?? 0)));
    const regle = decalerSerie(ttc, delaiJours, horizon);
    cumuler(r.fournisseurs.engage, ttc);
    cumuler(r.fournisseurs.regle, regle);
    cumuler(r.tvaDeductible, tva);
    for (let i = 0; i < n; i++) {
      parCategorie[categorie][i] += montants[i] ?? 0;
      r.totalParExercice[i] += montants[i] ?? 0;
      if (fixe) r.fixesParExercice[i] += montants[i] ?? 0;
      else r.variablesParExercice[i] += montants[i] ?? 0;
      if (estAchatConsomme(categorie as LigneCharge['categorie'])) {
        r.achatsConsommables[i] += montants[i] ?? 0;
      }
    }
  };

  for (const ligne of dossier.charges.lignes) {
    if (!ligne.actif) continue;

    const brut =
      ligne.mode === 'pourcentage_ca'
        ? Array.from({ length: n }, (_, i) => euro(val(caParExercice, i) * pct(val(ligne.pourcentages, i))))
        : Array.from({ length: n }, (_, i) => val(ligne.montants, i));

    const montants = totauxAnnuelsDepuisRepartition(brut, ligne.repartition, exercices);
    const mensuel = repartirSurCalendrier(montants, ligne.repartition, exercices);
    const taux = assujetti && ligne.tvaDeductible ? ligne.tauxTva : 0;
    const tva = mensuel.map((v) => euro(v * pct(taux)));
    const delai = ligne.delaiPaiementJours ?? p.bfr.delaiFournisseursJours;

    enregistrer(ligne.categorie, montants, mensuel, tva, delai, ligne.fixe);

    r.detail.push({
      ligneId: ligne.id,
      libelle: ligne.libelle,
      categorie: ligne.categorie,
      fixe: ligne.fixe,
      montants,
      mensuel,
      tauxTva: taux,
      tvaDeductible: ligne.tvaDeductible,
    });
  }

  // Achats induits par les recettes : variables par nature.
  if (supplements.achatsLiesParExercice.some((v) => v !== 0)) {
    enregistrer(
      'achats_marchandises',
      supplements.achatsLiesParExercice,
      supplements.achatsLiesMensuel,
      supplements.achatsLiesTva,
      p.bfr.delaiFournisseursJours,
      false,
    );
    r.detail.push({
      ligneId: 'achats_lies',
      libelle: 'Achats liés aux ventes',
      categorie: 'achats_marchandises',
      fixe: false,
      montants: [...supplements.achatsLiesParExercice],
      mensuel: [...supplements.achatsLiesMensuel],
      tauxTva: assujetti ? p.tva.tauxParDefaut : 0,
      tvaDeductible: assujetti,
    });
  }

  // Loyers de crédit-bail : charge externe fixe, le bien n'entrant pas à l'actif.
  if (supplements.loyersCreditBailParExercice.some((v) => v !== 0)) {
    enregistrer(
      'services_exterieurs',
      supplements.loyersCreditBailParExercice,
      supplements.loyersCreditBailMensuel,
      supplements.tvaCreditBail,
      p.bfr.delaiFournisseursJours,
      true,
    );
    r.detail.push({
      ligneId: 'credit_bail',
      libelle: 'Redevances de crédit-bail',
      categorie: 'services_exterieurs',
      fixe: true,
      montants: [...supplements.loyersCreditBailParExercice],
      mensuel: [...supplements.loyersCreditBailMensuel],
      tauxTva: assujetti ? p.tva.tauxParDefaut : 0,
      tvaDeductible: assujetti,
    });
  }

  for (const c of CATEGORIES) parCategorie[c] = parCategorie[c].map(euro);
  r.achatsConsommables = r.achatsConsommables.map(euro);
  r.totalParExercice = r.totalParExercice.map(euro);
  r.fixesParExercice = r.fixesParExercice.map(euro);
  r.variablesParExercice = r.variablesParExercice.map(euro);
  return r;
}

// ─── Personnel et rémunérations ───────────────────────────────────────────────

export interface ResultatPersonnel {
  detail: DetailPersonnel[];
  /** Salaires bruts et rémunérations déductibles, par exercice. */
  brutDeductible: number[];
  /** Charges sociales déductibles sur salaires et gérance, par exercice. */
  chargesDeductibles: number[];
  /** Prélèvements de l'exploitant, non déductibles, par exercice. */
  prelevements: number[];
  /** Rémunérations nettes décaissées, par mois absolu. */
  netMensuel: number[];
  /** Prélèvements de l'exploitant décaissés, par mois absolu. */
  prelevementsMensuel: number[];
  /** Compte de charges sociales : cotisations dues et réglées. */
  cotisations: Poste;
  /** Vrai si au moins une ligne relève d'un exploitant à cotisations assises sur le résultat. */
  aUnExploitant: boolean;
  /** Taux de cotisations retenu pour l'exploitant, en pourcentage. */
  tauxExploitant: number;
}

/**
 * Masse salariale et rémunérations des dirigeants.
 *
 * Les cotisations de l'exploitant d'un BNC ou d'un BIC à l'IR ne sont pas calculées
 * ici : leur assiette est le résultat lui-même, donc elles ne peuvent l'être qu'après
 * le compte de résultat. Voir `cotisationsExploitant()` dans le module fiscal.
 */
export function calculerPersonnel(dossier: Dossier, exercices: readonly Exercice[]): ResultatPersonnel {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const p = dossier.parametres;

  const r: ResultatPersonnel = {
    detail: [],
    brutDeductible: zeros(n),
    chargesDeductibles: zeros(n),
    prelevements: zeros(n),
    netMensuel: zeros(horizon),
    prelevementsMensuel: zeros(horizon),
    cotisations: posteVide(horizon),
    aUnExploitant: false,
    tauxExploitant: p.tns.tauxCotisations,
  };

  const tauxSalarial = pct(p.social.tauxChargesSalariales);
  const periodeCotisations = p.social.periodicite === 'trimestrielle' ? 3 : 1;

  for (const ligne of dossier.charges.personnel as LignePersonnel[]) {
    if (!ligne.actif) continue;

    const brut = zeros(n);
    const brutMensuel = zeros(horizon);

    for (let i = 0; i < n; i++) {
      const e = exercices[i];
      if (i < ligne.exerciceEmbauche) continue;
      const effectif = val(ligne.effectifs, i);
      const salaire = val(ligne.brutMensuel, i);
      if (effectif <= 0 || salaire === 0) continue;

      const moisPrevus = Math.min(val(ligne.nbMoisParExercice, i) || 12, e.nbMois);
      const premierMois = i === ligne.exerciceEmbauche ? Math.min(ligne.moisEmbauche, e.nbMois) : 1;
      const moisTravailles = Math.max(0, Math.min(moisPrevus, e.nbMois - premierMois + 1));
      if (moisTravailles <= 0) continue;

      const mensuel = euro(effectif * salaire);
      const prime = val(ligne.primes, i);
      brut[i] = euro(mensuel * moisTravailles + prime);

      for (let k = 0; k < moisTravailles; k++) {
        const m = e.moisDebutAbsolu + (premierMois - 1) + k;
        if (m < horizon) brutMensuel[m] += mensuel;
      }
      // La prime est versée sur le dernier mois travaillé de l'exercice.
      const moisPrime = e.moisDebutAbsolu + (premierMois - 1) + moisTravailles - 1;
      if (prime !== 0 && moisPrime < horizon) brutMensuel[moisPrime] += prime;
    }

    const exploitant = ligne.statut === 'exploitant';
    const tns = ligne.statut === 'dirigeant_tns';
    const tauxPatronal = pct(ligne.tauxChargesPatronales ?? p.social.tauxChargesPatronales);
    const tauxTns = pct(ligne.tauxCotisationsTns ?? p.tns.tauxCotisations);

    const charges = zeros(n);
    const net = zeros(n);
    const chargesMensuel = zeros(horizon);

    if (exploitant) {
      r.aUnExploitant = true;
      r.tauxExploitant = ligne.tauxCotisationsTns ?? p.tns.tauxCotisations;
      // Les prélèvements de l'exploitant ne sont pas une charge : ils diminuent son compte.
      for (let i = 0; i < n; i++) {
        r.prelevements[i] += brut[i];
        net[i] = brut[i];
      }
      cumuler(r.prelevementsMensuel, brutMensuel);
    } else if (tns) {
      for (let i = 0; i < n; i++) {
        charges[i] = euro(brut[i] * tauxTns - val(ligne.aides, i));
        net[i] = brut[i];
        r.brutDeductible[i] += brut[i];
        r.chargesDeductibles[i] += charges[i];
      }
      cumuler(r.netMensuel, brutMensuel);
      for (let m = 0; m < horizon; m++) chargesMensuel[m] = euro(brutMensuel[m] * tauxTns);
    } else {
      for (let i = 0; i < n; i++) {
        charges[i] = euro(brut[i] * tauxPatronal - val(ligne.aides, i));
        net[i] = euro(brut[i] * (1 - tauxSalarial));
        r.brutDeductible[i] += brut[i];
        r.chargesDeductibles[i] += charges[i];
      }
      for (let m = 0; m < horizon; m++) {
        r.netMensuel[m] += euro(brutMensuel[m] * (1 - tauxSalarial));
        chargesMensuel[m] = euro(brutMensuel[m] * (tauxPatronal + tauxSalarial));
      }
    }

    if (!exploitant) {
      // L'aide à l'embauche vient en diminution des cotisations réellement versées :
      // sans cela, la charge du compte de résultat et le décaissement divergeraient,
      // et l'écart se retrouverait au bilan.
      for (let i = 0; i < n; i++) {
        const aide = val(ligne.aides, i);
        if (aide === 0) continue;
        const e = exercices[i];
        const part = euro(aide / e.nbMois);
        for (let k = 0; k < e.nbMois; k++) {
          const m = e.moisDebutAbsolu + k;
          if (m < horizon) chargesMensuel[m] = euro(chargesMensuel[m] - part);
        }
      }

      // Les cotisations sont dues au fil de l'eau et réglées avec le décalage paramétré.
      const dues = regrouperParPeriode(chargesMensuel, periodeCotisations);
      cumuler(r.cotisations.engage, chargesMensuel);
      cumuler(r.cotisations.regle, decalerSerie(dues, p.social.decalageMois * 30, horizon));
    }

    r.detail.push({
      ligneId: ligne.id,
      libelle: ligne.libelle,
      statut: ligne.statut,
      brut: brut.map(euro),
      charges: charges.map(euro),
      net: net.map(euro),
      brutMensuel,
      chargesMensuel,
      nonDeductible: exploitant,
    });
  }

  r.brutDeductible = r.brutDeductible.map(euro);
  r.chargesDeductibles = r.chargesDeductibles.map(euro);
  r.prelevements = r.prelevements.map(euro);
  return r;
}

/**
 * Regroupe une série mensuelle sur des périodes de `taille` mois : le montant de la
 * période est porté sur son dernier mois, comme une déclaration trimestrielle.
 */
export function regrouperParPeriode(serie: readonly number[], taille: number): number[] {
  if (taille <= 1) return [...serie];
  const out = zeros(serie.length);
  let cumul = 0;
  for (let m = 0; m < serie.length; m++) {
    cumul += serie[m] ?? 0;
    if ((m + 1) % taille === 0 || m === serie.length - 1) {
      out[m] = euro(cumul);
      cumul = 0;
    }
  }
  return out;
}

/** Flux des apports, comptes courants et subventions de la section Financement. */
export interface FluxFinancements {
  apportsCapital: number[];
  apportsCapitalMensuel: number[];
  apportsComptesCourants: number[];
  comptesCourantsMensuel: number[];
  remboursementsComptesCourants: number[];
  remboursementsMensuel: number[];
  /** Solde des comptes courants à chaque clôture. */
  soldeComptesCourants: number[];
  /** Capital social cumulé à chaque clôture. */
  capitalCumule: number[];
  subventionsInvestissement: number[];
  subventionsExploitation: number[];
  subventionsMensuel: number[];
  /** Reprise des subventions d'investissement au résultat, par exercice. */
  reprisesSubventions: number[];
  /** Subventions d'investissement restant au passif à chaque clôture. */
  subventionsAuPassif: number[];
  /** Intérêts servis sur les comptes courants, par exercice. */
  interetsComptesCourants: number[];
}

export function calculerFinancements(
  dossier: Dossier,
  exercices: readonly Exercice[],
): FluxFinancements {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const f: FluxFinancements = {
    apportsCapital: zeros(n),
    apportsCapitalMensuel: zeros(horizon),
    apportsComptesCourants: zeros(n),
    comptesCourantsMensuel: zeros(horizon),
    remboursementsComptesCourants: zeros(n),
    remboursementsMensuel: zeros(horizon),
    soldeComptesCourants: zeros(n),
    capitalCumule: zeros(n),
    subventionsInvestissement: zeros(n),
    subventionsExploitation: zeros(n),
    subventionsMensuel: zeros(horizon),
    reprisesSubventions: zeros(n),
    subventionsAuPassif: zeros(n),
    interetsComptesCourants: zeros(n),
  };

  for (const apport of dossier.financements.apports) {
    if (!apport.actif || apport.montant === 0) continue;
    // Hors horizon, ni trésorerie ni capitaux propres : les deux ou aucun.
    const m = moisAbsoluDansHorizon(exercices, apport.exercice, apport.mois);
    if (m === null) continue;
    const compteCourant = apport.type === 'compte_courant';

    if (compteCourant) {
      f.apportsComptesCourants[apport.exercice] += apport.montant;
      if (m < horizon) f.comptesCourantsMensuel[m] += apport.montant;
      for (let i = 0; i < n; i++) {
        const remb = val(apport.remboursements, i);
        if (remb !== 0) {
          f.remboursementsComptesCourants[i] += remb;
          const e = exercices[i];
          const moisRemb = e.moisDebutAbsolu + e.nbMois - 1;
          if (moisRemb < horizon) f.remboursementsMensuel[moisRemb] += remb;
        }
      }
    } else {
      f.apportsCapital[apport.exercice] += apport.montant;
      // Un apport en nature ne donne lieu à aucun mouvement de trésorerie.
      if (m < horizon && apport.type !== 'capital_nature') f.apportsCapitalMensuel[m] += apport.montant;
    }
  }

  for (const s of dossier.financements.subventions) {
    if (!s.actif || s.montant === 0) continue;
    const m = moisAbsoluDansHorizon(exercices, s.exercice, s.mois);
    if (m === null) continue;
    if (m < horizon) f.subventionsMensuel[m] += s.montant;
    if (s.type === 'exploitation') {
      f.subventionsExploitation[s.exercice] += s.montant;
      continue;
    }
    f.subventionsInvestissement[s.exercice] += s.montant;
    if (s.repriseSurAnnees > 0) {
      const part = euro(s.montant / s.repriseSurAnnees);
      for (let k = 0; k < s.repriseSurAnnees; k++) {
        const i = s.exercice + k;
        if (i < n) f.reprisesSubventions[i] += part;
      }
    } else {
      f.reprisesSubventions[s.exercice] += s.montant;
    }
  }

  let capital = 0;
  let comptesCourants = 0;
  let subventions = 0;
  const tauxCC = pct(dossier.parametres.tauxInteretCompteCourant);
  for (let i = 0; i < n; i++) {
    capital = euro(capital + f.apportsCapital[i]);
    comptesCourants = euro(
      comptesCourants + f.apportsComptesCourants[i] - f.remboursementsComptesCourants[i],
    );
    subventions = euro(subventions + f.subventionsInvestissement[i] - f.reprisesSubventions[i]);
    f.capitalCumule[i] = capital;
    f.soldeComptesCourants[i] = comptesCourants;
    f.subventionsAuPassif[i] = subventions;
    f.interetsComptesCourants[i] = euro(comptesCourants * tauxCC);
  }

  return f;
}

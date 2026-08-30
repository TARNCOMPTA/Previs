import { normaliserDossier, type Anomalie, type Dossier } from '../model/dossier.js';
import { estSocieteIS } from '../model/identite.js';
import { construireControles, detecterAnomalies } from './controles.js';
import {
  compteResultatVide,
  construireCaf,
  construireRatios,
  construireSeuil,
  construireSig,
  joursExercice,
} from './etats.js';
import {
  calculerCreditsBaux,
  calculerFluxEmprunts,
  tableauAmortissement,
} from './emprunts.js';
import {
  calculerCharges,
  calculerFinancements,
  calculerPersonnel,
  calculerRecettes,
  encoursCloture,
  posteVide,
  regrouperParPeriode,
  type Poste,
} from './flux.js';
import {
  calculerCessions,
  calculerFluxInvestissements,
  dotationsParExercice,
  planAmortissement,
} from './immobilisations.js';
import { cotisationsExploitant, calculerTva, echeancierImpot, impotSocietes } from './fiscal.js';
import { construireExercices, libellesMois, nbMoisTotal } from './periodes.js';
import { decalerSerie, repartirSurCalendrier } from './repartition.js';
import type {
  Bfr,
  Bilan,
  CompteResultat,
  MoisTresorerie,
  PlanFinancement,
  Resultats,
} from './types.js';
import { div, euro, pct, val, zeros } from './utils.js';

/** Produits et charges exceptionnels, avec leur incidence sur la trésorerie. */
function calculerExceptionnels(dossier: Dossier, exercices: ReturnType<typeof construireExercices>) {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const assujetti = dossier.parametres.tva.assujetti;

  const produits = zeros(n);
  const charges = zeros(n);
  const tvaCollectee = zeros(horizon);
  const tvaDeductible = zeros(horizon);
  const encaissements = zeros(horizon);
  const decaissements = zeros(horizon);
  const posteProduits = posteVide(horizon);
  const posteCharges = posteVide(horizon);

  for (const ligne of dossier.autres.exceptionnels) {
    if (!ligne.actif) continue;
    const mensuel = repartirSurCalendrier(ligne.montants, ligne.repartition, exercices);
    const taux = assujetti ? ligne.tauxTva : 0;

    for (let i = 0; i < n; i++) {
      if (ligne.sens === 'produit') produits[i] += val(ligne.montants, i);
      else charges[i] += val(ligne.montants, i);
    }

    for (let m = 0; m < horizon; m++) {
      const ht = mensuel[m];
      if (!ht) continue;
      const tva = euro(ht * pct(taux));
      const ttc = euro(ht + tva);
      if (ligne.sens === 'produit') {
        tvaCollectee[m] += tva;
        posteProduits.engage[m] += ttc;
        if (ligne.impacteTresorerie) {
          posteProduits.regle[m] += ttc;
          encaissements[m] += ttc;
        }
      } else {
        tvaDeductible[m] += tva;
        posteCharges.engage[m] += ttc;
        if (ligne.impacteTresorerie) {
          posteCharges.regle[m] += ttc;
          decaissements[m] += ttc;
        }
      }
    }
  }

  return {
    produits: produits.map(euro),
    charges: charges.map(euro),
    tvaCollectee,
    tvaDeductible,
    encaissements,
    decaissements,
    posteProduits,
    posteCharges,
  };
}

/** Dividendes et prélèvements de l'exploitant portés dans la section Autres. */
function calculerDistributions(dossier: Dossier, exercices: ReturnType<typeof construireExercices>) {
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const dividendes = zeros(n);
  const prelevements = zeros(n);
  const mensuel = zeros(horizon);

  for (const ligne of dossier.autres.distributions) {
    if (!ligne.actif) continue;
    const serie = repartirSurCalendrier(ligne.montants, ligne.repartition, exercices);
    for (let m = 0; m < horizon; m++) mensuel[m] += serie[m];
    for (let i = 0; i < n; i++) {
      const montant = val(ligne.montants, i);
      if (ligne.type === 'dividendes') dividendes[i] += montant;
      else prelevements[i] += montant;
    }
  }

  return { dividendes: dividendes.map(euro), prelevements: prelevements.map(euro), mensuel };
}

/**
 * Calcule l'intégralité des états financiers d'un dossier prévisionnel.
 *
 * La fonction est pure et déterministe : à dossier identique, chiffres identiques dans
 * l'interface, sur le serveur et dans le PDF. Elle ne lève jamais sur un dossier
 * incomplet — un dossier vide produit des états à zéro et des anomalies de saisie.
 *
 * L'équilibre du bilan n'est pas obtenu par ajustement : chaque compte de tiers vaut
 * « cumul engagé − cumul réglé » des mêmes séries qui alimentent la trésorerie, si bien
 * qu'aucun montant ne peut figurer d'un seul côté du bilan.
 */
export function calculer(dossierEntree: Dossier): Resultats {
  const dossier = normaliserDossier(dossierEntree);
  const p = dossier.parametres;
  const exercices = construireExercices(p);
  const horizon = nbMoisTotal(exercices);
  const n = exercices.length;
  const libelles = libellesMois(p, exercices);
  const societe = estSocieteIS(dossier.identite.regime);

  // ─── Immobilisations, emprunts et crédits-baux ──────────────────────────────
  const lignesActives = dossier.investissements.lignes.filter((l) => l.actif);
  const plans = lignesActives.map((l) => planAmortissement(l, exercices));
  const fluxInv = calculerFluxInvestissements(dossier, exercices);
  const cessions = calculerCessions(dossier, exercices, plans);
  const dotations = dotationsParExercice(plans, n);

  const tableaux = dossier.financements.emprunts
    .filter((e) => e.actif)
    .map((e) => tableauAmortissement(e, exercices));
  const fluxEmp = calculerFluxEmprunts(dossier, exercices, tableaux);
  const creditsBaux = calculerCreditsBaux(dossier, exercices);

  // ─── Recettes, charges, personnel, financements ─────────────────────────────
  const recettes = calculerRecettes(dossier, exercices);
  const charges = calculerCharges(dossier, exercices, recettes.caParExercice, {
    achatsLiesMensuel: recettes.achatsLiesMensuel,
    achatsLiesParExercice: recettes.achatsLiesParExercice,
    achatsLiesTva: recettes.achatsLiesTva,
    loyersCreditBailMensuel: creditsBaux.loyersHT,
    loyersCreditBailParExercice: creditsBaux.loyersParExercice,
    tvaCreditBail: creditsBaux.tvaDeductible,
  });
  const personnel = calculerPersonnel(dossier, exercices);
  const financements = calculerFinancements(dossier, exercices);
  const exceptionnels = calculerExceptionnels(dossier, exercices);
  const distributions = calculerDistributions(dossier, exercices);

  // ─── Cotisation foncière des entreprises ────────────────────────────────────
  // Engagée et réglée sur le dernier mois de l'exercice : aucune dette au bilan.
  const cfeMensuelle = zeros(horizon);
  for (let i = 0; i < n; i++) {
    const montant = val(p.cfe, i);
    if (montant === 0) continue;
    const e = exercices[i];
    cfeMensuelle[e.moisDebutAbsolu + e.nbMois - 1] += montant;
  }

  // ─── Stocks ─────────────────────────────────────────────────────────────────
  // Le stock de départ est une acquisition, pas une charge : il n'entre donc pas
  // dans la variation de stock du compte de résultat, seulement à l'actif.
  const stockInitialCumule = zeros(n);
  let cumulStockInitial = 0;
  for (let i = 0; i < n; i++) {
    cumulStockInitial = euro(cumulStockInitial + fluxInv.stockInitial[i]);
    stockInitialCumule[i] = cumulStockInitial;
  }
  const rotation = p.bfr.rotationStockJours;
  const stockExploitation = charges.achatsConsommables.map((achats, i) =>
    rotation > 0 ? euro((achats * rotation) / joursExercice(exercices[i].nbMois)) : 0,
  );

  // ─── TVA ────────────────────────────────────────────────────────────────────
  const tvaCollectee = zeros(horizon);
  const tvaDeductibleBS = zeros(horizon);
  for (let m = 0; m < horizon; m++) {
    tvaCollectee[m] = euro(
      recettes.tvaCollectee[m] + cessions.tvaCollectee[m] + exceptionnels.tvaCollectee[m],
    );
    tvaDeductibleBS[m] = euro(charges.tvaDeductible[m] + exceptionnels.tvaDeductible[m]);
  }
  const tva = calculerTva(
    p,
    exercices,
    tvaCollectee,
    tvaDeductibleBS,
    fluxInv.tvaRecuperable,
    libelles,
  );

  // ─── Compte de résultat ─────────────────────────────────────────────────────
  const comptes: CompteResultat[] = [];
  const cotisationsExploitantParExercice = zeros(n);
  const impotParExercice = zeros(n);
  let deficitReportable = 0;

  for (let i = 0; i < n; i++) {
    const c = compteResultatVide(i);

    c.ventesMarchandises = euro(recettes.marchandisesParExercice[i]);
    c.production = euro(recettes.productionParExercice[i]);
    c.chiffreAffaires = euro(recettes.caParExercice[i]);
    c.subventionsExploitation = euro(
      recettes.subventionsExploitation[i] + financements.subventionsExploitation[i],
    );
    c.autresProduits = euro(recettes.autresProduits[i]);
    c.totalProduitsExploitation = euro(
      c.chiffreAffaires + c.subventionsExploitation + c.autresProduits,
    );

    c.achatsMarchandises = charges.parCategorie.achats_marchandises[i];
    c.achatsMatieres = charges.parCategorie.achats_matieres[i];
    // Présentation française : la variation vaut « stock initial − stock final ».
    c.variationStock = euro((i > 0 ? stockExploitation[i - 1] : 0) - stockExploitation[i]);
    c.autresAchats = charges.parCategorie.fournitures[i];
    c.sousTraitance = charges.parCategorie.sous_traitance[i];
    c.servicesExterieurs = charges.parCategorie.services_exterieurs[i];
    c.autresServicesExterieurs = charges.parCategorie.autres_services_exterieurs[i];
    c.impotsTaxes = euro(charges.parCategorie.impots_taxes[i] + val(p.cfe, i));
    c.salairesBruts = personnel.brutDeductible[i];
    c.dotationsAmortissements = dotations[i];
    c.autresCharges = charges.parCategorie.autres_charges[i];

    c.produitsFinanciers = 0;
    c.chargesFinancieres = euro(
      fluxEmp.chargesFinancieres[i] +
        fluxEmp.fraisParExercice[i] +
        financements.interetsComptesCourants[i] +
        charges.parCategorie.charges_financieres[i],
    );
    c.resultatFinancier = euro(c.produitsFinanciers - c.chargesFinancieres);

    // Le prix de cession est un produit exceptionnel, la valeur nette comptable une
    // charge exceptionnelle : leur différence constitue la plus ou moins-value.
    c.produitsExceptionnels = euro(
      exceptionnels.produits[i] + financements.reprisesSubventions[i] + cessions.prixParExercice[i],
    );
    c.chargesExceptionnelles = euro(exceptionnels.charges[i] + cessions.vncParExercice[i]);
    c.resultatExceptionnel = euro(c.produitsExceptionnels - c.chargesExceptionnelles);

    const finaliser = (cotisationsExploitant: number) => {
      c.chargesSociales = euro(personnel.chargesDeductibles[i] + cotisationsExploitant);
      c.totalChargesExploitation = euro(
        c.achatsMarchandises +
          c.variationStock +
          c.achatsMatieres +
          c.autresAchats +
          c.sousTraitance +
          c.servicesExterieurs +
          c.autresServicesExterieurs +
          c.impotsTaxes +
          c.salairesBruts +
          c.chargesSociales +
          c.dotationsAmortissements +
          c.autresCharges,
      );
      c.resultatExploitation = euro(c.totalProduitsExploitation - c.totalChargesExploitation);
      c.resultatCourant = euro(c.resultatExploitation + c.resultatFinancier);
      c.resultatAvantImpot = euro(c.resultatCourant + c.resultatExceptionnel);
    };

    finaliser(0);

    // Les cotisations de l'exploitant s'assoient sur le résultat lui-même : la
    // circularité est résolue une fois le résultat avant cotisations connu.
    if (personnel.aUnExploitant) {
      const cotisations = cotisationsExploitant(c.resultatAvantImpot, p, personnel.tauxExploitant);
      cotisationsExploitantParExercice[i] = cotisations;
      finaliser(cotisations);
    }

    if (societe) {
      const { impot, deficitRestant } = impotSocietes(c.resultatAvantImpot, deficitReportable, p);
      c.impotSocietes = impot;
      deficitReportable = deficitRestant;
      impotParExercice[i] = impot;
    } else {
      // L'impôt sur le revenu est personnel : il n'est jamais une charge de l'entreprise.
      c.impotRevenuEstime = euro(Math.max(0, c.resultatAvantImpot) * pct(p.ir.tauxMoyen));
    }

    c.resultatNet = euro(c.resultatAvantImpot - c.impotSocietes);
    comptes.push(c);
  }

  // ─── Décaissements dérivés du compte de résultat ────────────────────────────
  const cotisationsExploitantPoste: Poste = posteVide(horizon);
  if (personnel.aUnExploitant) {
    const engage = zeros(horizon);
    for (let i = 0; i < n; i++) {
      const e = exercices[i];
      const part = euro(cotisationsExploitantParExercice[i] / e.nbMois);
      for (let k = 0; k < e.nbMois; k++) engage[e.moisDebutAbsolu + k] += part;
    }
    const periode = p.tns.periodicite === 'trimestrielle' ? 3 : 1;
    cotisationsExploitantPoste.engage = engage;
    cotisationsExploitantPoste.regle = decalerSerie(regrouperParPeriode(engage, periode), 30, horizon);
  }

  const impotMensuel = societe ? echeancierImpot(impotParExercice, exercices, p) : zeros(horizon);
  const irMensuel = zeros(horizon);
  if (!societe && p.ir.decaisse) {
    for (let i = 0; i < n; i++) {
      const e = exercices[i];
      const part = euro(comptes[i].impotRevenuEstime / e.nbMois);
      for (let k = 0; k < e.nbMois; k++) irMensuel[e.moisDebutAbsolu + k] += part;
    }
  }

  const interetsCcMensuel = zeros(horizon);
  for (let i = 0; i < n; i++) {
    const e = exercices[i];
    interetsCcMensuel[e.moisDebutAbsolu + e.nbMois - 1] += financements.interetsComptesCourants[i];
  }

  // ─── Trésorerie mensuelle ───────────────────────────────────────────────────
  const tresorerie: MoisTresorerie[] = [];
  let solde = p.tresorerieInitiale;
  for (let m = 0; m < horizon; m++) {
    const soldeInitial = solde;
    const restitutionDepots = Math.max(0, -(creditsBaux.depots[m] ?? 0));
    const versementDepots = Math.max(0, creditsBaux.depots[m] ?? 0);

    const encaissements = {
      ventes: euro(recettes.clients.regle[m]),
      apports: euro(financements.apportsCapitalMensuel[m] + financements.comptesCourantsMensuel[m]),
      emprunts: euro(fluxEmp.deblocages[m]),
      subventions: euro(financements.subventionsMensuel[m]),
      cessions: euro(cessions.encaisseTTC[m] + restitutionDepots),
      tvaRemboursee: euro(tva.remboursements[m]),
      autres: euro(exceptionnels.encaissements[m]),
      total: 0,
    };
    encaissements.total = euro(
      encaissements.ventes +
        encaissements.apports +
        encaissements.emprunts +
        encaissements.subventions +
        encaissements.cessions +
        encaissements.tvaRemboursee +
        encaissements.autres,
    );

    const decaissements = {
      achatsEtCharges: euro(charges.fournisseurs.regle[m]),
      salaires: euro(personnel.netMensuel[m]),
      chargesSociales: euro(personnel.cotisations.regle[m] + cotisationsExploitantPoste.regle[m]),
      investissements: euro(fluxInv.decaisseTTC[m] + creditsBaux.levees[m] + versementDepots),
      echeancesEmprunts: euro(fluxEmp.echeances[m] + fluxEmp.frais[m]),
      tva: euro(tva.decaissements[m]),
      impots: euro(impotMensuel[m] + cfeMensuelle[m] + irMensuel[m]),
      distributions: euro(distributions.mensuel[m] + personnel.prelevementsMensuel[m]),
      autres: euro(
        financements.remboursementsMensuel[m] +
          exceptionnels.decaissements[m] +
          interetsCcMensuel[m],
      ),
      total: 0,
    };
    decaissements.total = euro(
      decaissements.achatsEtCharges +
        decaissements.salaires +
        decaissements.chargesSociales +
        decaissements.investissements +
        decaissements.echeancesEmprunts +
        decaissements.tva +
        decaissements.impots +
        decaissements.distributions +
        decaissements.autres,
    );

    const variation = euro(encaissements.total - decaissements.total);
    solde = euro(soldeInitial + variation);

    tresorerie.push({
      moisAbsolu: m,
      exercice: exercices.find((e) => m >= e.moisDebutAbsolu && m < e.moisDebutAbsolu + e.nbMois)?.index ?? 0,
      libelle: libelles[m] ?? '',
      soldeInitial,
      encaissements,
      decaissements,
      variation,
      soldeFinal: solde,
    });
  }

  const soldeFinParExercice = exercices.map(
    (e) => tresorerie[e.moisDebutAbsolu + e.nbMois - 1]?.soldeFinal ?? p.tresorerieInitiale,
  );
  let soldeMinimum = tresorerie.length > 0 ? tresorerie[0].soldeFinal : p.tresorerieInitiale;
  let moisSoldeMinimum = 0;
  for (const mois of tresorerie) {
    if (mois.soldeFinal < soldeMinimum) {
      soldeMinimum = mois.soldeFinal;
      moisSoldeMinimum = mois.moisAbsolu;
    }
  }

  // ─── Bilan d'ouverture ──────────────────────────────────────────────────────
  const ouverture = dossier.autres.bilanOuverture;
  const ouvertureActive = ouverture.actif;
  const actifOuverture = euro(
    (ouvertureActive
      ? ouverture.immobilisationsBrutes -
        ouverture.amortissementsCumules +
        ouverture.stocks +
        ouverture.creancesClients +
        ouverture.autresCreances
      : 0) + p.tresorerieInitiale,
  );
  // Sans bilan d'ouverture saisi, la trésorerie initiale est un apport de l'exploitant
  // porté en report à nouveau : elle trouve ainsi sa contrepartie au passif, et le
  // bilan d'ouverture est équilibré par construction.
  const passifOuverture = ouvertureActive
    ? euro(
        ouverture.capitalSocial +
          ouverture.reserves +
          ouverture.reportANouveau +
          ouverture.comptesCourants +
          ouverture.empruntsRestantDus +
          ouverture.dettesFournisseurs +
          ouverture.dettesFiscalesSociales,
      )
    : euro(p.tresorerieInitiale);
  const reportOuverture = ouvertureActive ? ouverture.reportANouveau : euro(p.tresorerieInitiale);
  const ecartOuverture = euro(actifOuverture - passifOuverture);

  // ─── Besoin en fonds de roulement ───────────────────────────────────────────
  const bfr: Bfr[] = [];
  const posteInvestissements: Poste = {
    engage: fluxInv.engageTTC,
    regle: fluxInv.decaisseTTC,
  };

  let cumulImpot = 0;
  let cumulImpotPaye = 0;
  for (let i = 0; i < n; i++) {
    const e = exercices[i];
    const fin = e.moisDebutAbsolu + e.nbMois;
    cumulImpot = euro(cumulImpot + impotParExercice[i]);
    cumulImpotPaye = 0;
    for (let m = 0; m < fin; m++) cumulImpotPaye += impotMensuel[m] ?? 0;

    const stocks = euro(stockInitialCumule[i] + stockExploitation[i] + (ouvertureActive ? ouverture.stocks : 0));
    const creancesClients = euro(
      encoursCloture(recettes.clients, e) + (ouvertureActive ? ouverture.creancesClients : 0),
    );
    const creditTva = tva.creditParExercice[i];
    const autresCreances = euro(
      encoursCloture(exceptionnels.posteProduits, e) + (ouvertureActive ? ouverture.autresCreances : 0),
    );

    const dettesFournisseurs = euro(
      encoursCloture(charges.fournisseurs, e) + (ouvertureActive ? ouverture.dettesFournisseurs : 0),
    );
    const tvaADecaisser = tva.dueParExercice[i];
    const dettesSociales = euro(
      encoursCloture(personnel.cotisations, e) +
        encoursCloture(cotisationsExploitantPoste, e) +
        (ouvertureActive ? ouverture.dettesFiscalesSociales : 0),
    );
    const dettesFiscales = euro(Math.max(0, cumulImpot - cumulImpotPaye));
    const autresDettes = euro(
      encoursCloture(posteInvestissements, e) + encoursCloture(exceptionnels.posteCharges, e),
    );

    const totalBesoins = euro(stocks + creancesClients + creditTva + autresCreances);
    const totalRessources = euro(
      dettesFournisseurs + tvaADecaisser + dettesSociales + dettesFiscales + autresDettes,
    );
    const montant = euro(totalBesoins - totalRessources);

    bfr.push({
      exercice: i,
      stocks,
      creancesClients,
      creditTva,
      autresCreances,
      totalBesoins,
      dettesFournisseurs,
      tvaADecaisser,
      dettesSociales,
      dettesFiscales,
      autresDettes,
      totalRessources,
      bfr: montant,
      variation: euro(montant - (i > 0 ? bfr[i - 1].bfr : 0)),
      enJoursCA: Math.round(
        div(montant, recettes.caParExercice[i]) * joursExercice(e.nbMois),
      ),
    });
  }

  // ─── Bilans ─────────────────────────────────────────────────────────────────
  const bilans: Bilan[] = [];
  let cumulDotations = 0;
  let reserves = ouvertureActive ? ouverture.reserves : 0;
  let report = reportOuverture;
  let capitalExploitant = ouvertureActive ? ouverture.capitalSocial : euro(p.tresorerieInitiale);
  const plafondReserve = (capital: number) => euro(capital * pct(p.plafondReserveLegalePourcent));

  for (let i = 0; i < n; i++) {
    cumulDotations = euro(cumulDotations + dotations[i]);

    if (i > 0) {
      const precedent = comptes[i - 1];
      if (societe) {
        const dotationReserve =
          precedent.resultatNet > 0
            ? Math.min(
                euro(precedent.resultatNet * pct(p.reserveLegalePourcent)),
                Math.max(0, plafondReserve(financements.capitalCumule[i]) - reserves),
              )
            : 0;
        reserves = euro(reserves + dotationReserve);
        report = euro(report + precedent.resultatNet - dotationReserve - distributions.dividendes[i]);
      }
    } else if (societe) {
      report = euro(report - distributions.dividendes[0]);
    }

    if (!societe) {
      // Compte de l'exploitant : apports cumulés, résultats antérieurs conservés,
      // diminués des prélèvements personnels de l'exercice et des exercices passés.
      const resultatsAnterieurs = comptes.slice(0, i).reduce((t, c) => t + c.resultatNet, 0);
      const prelevementsCumules = personnel.prelevements
        .slice(0, i + 1)
        .reduce((t, v) => t + v, 0) +
        distributions.prelevements.slice(0, i + 1).reduce((t, v) => t + v, 0) +
        (p.ir.decaisse ? comptes.slice(0, i + 1).reduce((t, c) => t + c.impotRevenuEstime, 0) : 0);
      capitalExploitant = euro(
        (ouvertureActive ? ouverture.capitalSocial + ouverture.reserves + ouverture.reportANouveau : p.tresorerieInitiale) +
          financements.capitalCumule[i] +
          resultatsAnterieurs -
          prelevementsCumules,
      );
    }

    const brutIncorporelles = euro(
      fluxInv.brutesParNature.incorporelles[i] +
        (ouvertureActive ? ouverture.immobilisationsBrutes : 0),
    );
    const brutCorporelles = euro(
      fluxInv.brutesParNature.corporelles[i] +
        creditsBaux.leveesCumulees[i] -
        cessions.brutSortiCumule[i],
    );
    const brutFinancieres = euro(
      fluxInv.brutesParNature.financieres[i] + creditsBaux.depotsImmobilises[i],
    );
    const amortissements = euro(
      cumulDotations -
        cessions.amortSortiCumule[i] +
        (ouvertureActive ? ouverture.amortissementsCumules : 0),
    );
    const immobilisationsNettes = euro(
      brutIncorporelles + brutCorporelles + brutFinancieres - amortissements,
    );

    const f = bfr[i];
    const disponibilites = soldeFinParExercice[i];
    const totalActif = euro(
      immobilisationsNettes + f.stocks + f.creancesClients + f.creditTva + f.autresCreances + disponibilites,
    );

    const capitalSocial = societe
      ? euro(financements.capitalCumule[i] + (ouvertureActive ? ouverture.capitalSocial : 0))
      : capitalExploitant;
    const primesEtReserves = societe ? reserves : 0;
    const reportANouveau = societe ? report : 0;
    const capitauxPropres = euro(
      capitalSocial +
        primesEtReserves +
        reportANouveau +
        comptes[i].resultatNet +
        financements.subventionsAuPassif[i],
    );

    const emprunts = euro(
      fluxEmp.capitalRestantDu[i] + (ouvertureActive ? ouverture.empruntsRestantDus : 0),
    );
    const comptesCourants = euro(
      financements.soldeComptesCourants[i] + (ouvertureActive ? ouverture.comptesCourants : 0),
    );
    const dettesFiscalesSociales = euro(f.tvaADecaisser + f.dettesSociales + f.dettesFiscales);

    const totalPassif = euro(
      capitauxPropres +
        comptesCourants +
        emprunts +
        f.dettesFournisseurs +
        dettesFiscalesSociales +
        f.autresDettes,
    );

    bilans.push({
      exercice: i,
      actif: {
        immobilisationsIncorporelles: brutIncorporelles,
        immobilisationsCorporelles: brutCorporelles,
        immobilisationsFinancieres: brutFinancieres,
        amortissements,
        immobilisationsNettes,
        stocks: f.stocks,
        creancesClients: f.creancesClients,
        autresCreances: euro(f.creditTva + f.autresCreances),
        disponibilites,
        total: totalActif,
      },
      passif: {
        capitalSocial,
        primesEtReserves,
        reportANouveau,
        resultatExercice: comptes[i].resultatNet,
        subventionsInvestissement: financements.subventionsAuPassif[i],
        capitauxPropres,
        comptesCourants,
        empruntsDettesFinancieres: emprunts,
        dettesFournisseurs: f.dettesFournisseurs,
        dettesFiscalesSociales,
        autresDettes: f.autresDettes,
        total: totalPassif,
      },
      ecart: euro(totalActif - totalPassif),
    });
  }

  // ─── Capacité d'autofinancement et plan de financement ──────────────────────
  const caf = construireCaf(
    comptes,
    financements.reprisesSubventions,
    cessions.plusValuesParExercice,
    fluxEmp.capitalRembourse,
  );

  const planFinancement: PlanFinancement[] = [];
  let soldeCumule = 0;
  for (let i = 0; i < n; i++) {
    // Le stock de départ n'est pas repris ici : il est financé par la variation du
    // besoin en fonds de roulement, où il figure déjà à l'actif circulant. Les levées
    // d'option et les dépôts de garantie de crédit-bail, eux, entrent bien à l'actif
    // immobilisé : leur variation est un besoin de financement de l'exercice.
    const variationLevees = euro(
      creditsBaux.leveesCumulees[i] - (i > 0 ? creditsBaux.leveesCumulees[i - 1] : 0),
    );
    const variationDepots = euro(
      creditsBaux.depotsImmobilises[i] - (i > 0 ? creditsBaux.depotsImmobilises[i - 1] : 0),
    );
    const investissements = euro(
      fluxInv.totalParExercice[i] + variationLevees + variationDepots,
    );
    const besoins = {
      investissements,
      remboursementsEmprunts: fluxEmp.capitalRembourse[i],
      remboursementsComptesCourants: financements.remboursementsComptesCourants[i],
      variationBfr: bfr[i].variation,
      distributions: euro(
        distributions.dividendes[i] + distributions.prelevements[i] + personnel.prelevements[i],
      ),
      total: 0,
    };
    besoins.total = euro(
      besoins.investissements +
        besoins.remboursementsEmprunts +
        besoins.remboursementsComptesCourants +
        besoins.variationBfr +
        besoins.distributions,
    );

    const ressources = {
      caf: caf[i].caf,
      apports: euro(financements.apportsCapital[i] + financements.apportsComptesCourants[i]),
      emprunts: fluxEmp.deblocagesParExercice[i],
      subventions: financements.subventionsInvestissement[i],
      cessions: cessions.prixParExercice[i],
      total: 0,
    };
    ressources.total = euro(
      ressources.caf +
        ressources.apports +
        ressources.emprunts +
        ressources.subventions +
        ressources.cessions,
    );

    const soldeExercice = euro(ressources.total - besoins.total);
    soldeCumule = euro(soldeCumule + soldeExercice);
    planFinancement.push({
      exercice: i,
      besoins,
      ressources,
      solde: soldeExercice,
      soldeCumule,
    });
  }

  // ─── Ratios et seuil de rentabilité ─────────────────────────────────────────
  const sig = construireSig(comptes);
  const seuilRentabilite = construireSeuil({
    chiffreAffaires: comptes.map((c) => c.chiffreAffaires),
    chargesVariables: charges.variablesParExercice.map((v, i) =>
      euro(v + comptes[i].variationStock),
    ),
    chargesFixes: comptes.map((c, i) =>
      euro(
        c.totalChargesExploitation -
          charges.variablesParExercice[i] -
          comptes[i].variationStock +
          c.chargesFinancieres,
      ),
    ),
    capitalRembourse: fluxEmp.capitalRembourse,
    nbJoursParExercice: exercices.map((e) => joursExercice(e.nbMois)),
  });

  const annuites = fluxEmp.capitalRembourse.map((capital, i) =>
    euro(capital + fluxEmp.chargesFinancieres[i]),
  );
  const ratios = construireRatios({
    nbExercices: n,
    chiffreAffaires: comptes.map((c) => c.chiffreAffaires),
    sig,
    comptes,
    caf,
    capitauxPropres: bilans.map((b) => b.passif.capitauxPropres),
    dettesFinancieres: bilans.map((b) =>
      euro(b.passif.empruntsDettesFinancieres + b.passif.comptesCourants),
    ),
    annuites,
    bfr: bfr.map((b) => b.bfr),
    stocks: bfr.map((b) => b.stocks),
    achatsConsommes: charges.achatsConsommables,
    nbJoursParExercice: exercices.map((e) => joursExercice(e.nbMois)),
  });

  // ─── Contrôles et anomalies ─────────────────────────────────────────────────
  const capaciteRemboursement = ratios.find((r) => r.code === 'capacite_remboursement')?.valeurs ?? [];
  const controles = construireControles({
    exercices,
    bilans,
    bfr,
    comptes,
    caf,
    planFinancement,
    tresorerie,
    tva: { periodes: tva.periodes },
    dotations,
    amortSortiCumule: cessions.amortSortiCumule,
    ecartOuverture,
    tresorerieInitiale: p.tresorerieInitiale,
    capaciteRemboursement,
    seuilAtteint: seuilRentabilite.map((s) => s.atteint),
    besoinsDemarrage: planFinancement[0]?.besoins.total ?? 0,
    ressourcesDemarrage: planFinancement[0]?.ressources.total ?? 0,
  });

  const anomalies: Anomalie[] = detecterAnomalies({
    nbRecettes: dossier.recettes.lignes.filter((l) => l.actif).length,
    caTotal: recettes.caParExercice.reduce((t, v) => t + v, 0),
    empruntsSansMontant: dossier.financements.emprunts
      .filter((e) => e.actif && e.montant <= 0)
      .map((e) => e.libelle),
    investissementsSansDuree: lignesActives
      .filter(
        (l) =>
          l.modeAmortissement !== 'aucun' &&
          l.dureeAmortissementAnnees <= 0 &&
          l.montantHT > 0 &&
          l.categorie !== 'financier' &&
          l.categorie !== 'stock_initial' &&
          l.categorie !== 'tresorerie_demarrage',
      )
      .map((l) => l.libelle),
    personnelSansBrut: dossier.charges.personnel
      .filter((p2) => p2.actif && p2.brutMensuel.every((v) => !v))
      .map((p2) => p2.libelle),
    chargesSansMontant: dossier.charges.lignes.filter(
      (l) => l.actif && l.montants.every((v) => !v) && l.pourcentages.every((v) => !v),
    ).length,
    introductionVide: dossier.identite.introduction.trim().length === 0,
    raisonSocialeVide: dossier.identite.raisonSociale.trim().length === 0,
  });

  return {
    exercices,
    nbMois: horizon,
    libellesMois: libelles,
    amortissements: plans,
    emprunts: tableaux,
    recettes: {
      detail: recettes.detail,
      caParExercice: recettes.caParExercice,
      caMensuel: recettes.caMensuel,
    },
    charges: {
      detail: charges.detail,
      personnel: personnel.detail,
      totalParExercice: charges.totalParExercice,
    },
    compteResultat: comptes,
    sig,
    caf,
    ratios,
    seuilRentabilite,
    bfr,
    planFinancement,
    tresorerie: {
      mensuelle: tresorerie,
      soldeFinParExercice,
      soldeMinimum,
      moisSoldeMinimum,
    },
    tva: { periodes: tva.periodes, parExercice: tva.parExercice },
    bilans,
    controles,
    anomalies,
    coherent: controles.every((c) => c.ok || c.gravite !== 'erreur'),
  };
}

import type { CompteResultat, Caf, Ratio, SeuilRentabilite, Sig } from './types.js';
import { div, euro, zeros } from './utils.js';

/**
 * Soldes intermédiaires de gestion, dérivés du compte de résultat.
 *
 * La marge commerciale ne porte que sur les ventes de marchandises ; la production
 * regroupe les biens produits, les prestations et les honoraires.
 */
export function construireSig(comptes: readonly CompteResultat[]): Sig[] {
  return comptes.map((c) => {
    const coutAchatMarchandises = euro(c.achatsMarchandises + c.variationStock);
    const margeCommerciale = euro(c.ventesMarchandises - coutAchatMarchandises);
    const consommationsExterieures = euro(
      c.achatsMatieres + c.autresAchats + c.sousTraitance + c.servicesExterieurs + c.autresServicesExterieurs,
    );
    const margeGlobale = euro(margeCommerciale + c.production);
    const valeurAjoutee = euro(margeGlobale - consommationsExterieures);
    const chargesPersonnel = euro(c.salairesBruts + c.chargesSociales);
    const excedentBrutExploitation = euro(
      valeurAjoutee + c.subventionsExploitation - c.impotsTaxes - chargesPersonnel,
    );

    return {
      exercice: c.exercice,
      margeCommerciale,
      production: c.production,
      margeGlobale,
      consommationsExterieures,
      valeurAjoutee,
      subventions: c.subventionsExploitation,
      impotsTaxes: c.impotsTaxes,
      chargesPersonnel,
      excedentBrutExploitation,
      dotations: c.dotationsAmortissements,
      resultatExploitation: c.resultatExploitation,
      resultatCourant: c.resultatCourant,
      resultatExceptionnel: c.resultatExceptionnel,
      impots: c.impotSocietes,
      resultatNet: c.resultatNet,
    };
  });
}

/**
 * Capacité d'autofinancement, calculée à partir du résultat net.
 *
 * Les reprises de subvention et les plus-values de cession sont des produits qui
 * n'apportent pas de trésorerie d'exploitation : elles sont retranchées.
 */
export function construireCaf(
  comptes: readonly CompteResultat[],
  reprisesSubventions: readonly number[],
  plusValues: readonly number[],
  capitalRembourse: readonly number[],
): Caf[] {
  return comptes.map((c, i) => {
    const caf = euro(
      c.resultatNet + c.dotationsAmortissements - (reprisesSubventions[i] ?? 0) - (plusValues[i] ?? 0),
    );
    return {
      exercice: c.exercice,
      resultatNet: c.resultatNet,
      dotations: c.dotationsAmortissements,
      repriseSubventions: euro(reprisesSubventions[i] ?? 0),
      plusValuesCession: euro(plusValues[i] ?? 0),
      caf,
      autofinancementNet: euro(caf - (capitalRembourse[i] ?? 0)),
    };
  });
}

export interface EntreesSeuil {
  chiffreAffaires: number[];
  chargesVariables: number[];
  chargesFixes: number[];
  capitalRembourse: number[];
  nbJoursParExercice: number[];
}

/**
 * Seuil de rentabilité économique et financier.
 *
 * Le seuil financier ajoute aux charges fixes les remboursements d'emprunt en capital :
 * c'est le chiffre d'affaires à partir duquel l'entreprise couvre aussi ses échéances,
 * la question que pose systématiquement un banquier.
 */
export function construireSeuil(e: EntreesSeuil): SeuilRentabilite[] {
  return e.chiffreAffaires.map((ca, i) => {
    const variables = e.chargesVariables[i] ?? 0;
    const fixes = e.chargesFixes[i] ?? 0;
    const marge = euro(ca - variables);
    const tauxMarge = div(marge, ca);
    const seuil = tauxMarge > 0 ? euro(fixes / tauxMarge) : 0;
    const seuilFinancier =
      tauxMarge > 0 ? euro((fixes + (e.capitalRembourse[i] ?? 0)) / tauxMarge) : 0;
    const jours = e.nbJoursParExercice[i] ?? 360;

    return {
      exercice: i,
      chiffreAffaires: ca,
      chargesVariables: variables,
      margeSurCoutVariable: marge,
      tauxMargeSurCoutVariable: euro(tauxMarge * 100),
      chargesFixes: fixes,
      seuil,
      seuilFinancier,
      pointMortJours: ca > 0 && seuil > 0 ? Math.round(div(seuil, ca) * jours) : 0,
      margeSecurite: euro(ca - seuil),
      atteint: ca >= seuil && seuil > 0,
    };
  });
}

export interface EntreesRatios {
  nbExercices: number;
  chiffreAffaires: number[];
  sig: readonly Sig[];
  comptes: readonly CompteResultat[];
  caf: readonly Caf[];
  capitauxPropres: number[];
  dettesFinancieres: number[];
  annuites: number[];
  bfr: number[];
  stocks: number[];
  achatsConsommes: number[];
  nbJoursParExercice: number[];
}

/** Ratios d'exploitation et de structure, avec leur aide d'interprétation. */
export function construireRatios(e: EntreesRatios): Ratio[] {
  const n = e.nbExercices;
  const parCa = (valeurs: readonly number[]): number[] =>
    Array.from({ length: n }, (_, i) => euro(div(valeurs[i] ?? 0, e.chiffreAffaires[i] ?? 0) * 100));

  const ratios: Ratio[] = [
    {
      code: 'taux_marge_commerciale',
      libelle: 'Taux de marge commerciale',
      valeurs: Array.from({ length: n }, (_, i) =>
        euro(div(e.sig[i]?.margeCommerciale ?? 0, e.comptes[i]?.ventesMarchandises ?? 0) * 100),
      ),
      unite: '%',
      aide: 'Marge commerciale rapportée aux ventes de marchandises. Sans objet pour une activité de service.',
    },
    {
      code: 'taux_valeur_ajoutee',
      libelle: 'Taux de valeur ajoutée',
      valeurs: parCa(e.sig.map((s) => s.valeurAjoutee)),
      unite: '%',
      aide: 'Richesse créée par l’entreprise, rapportée au chiffre d’affaires. Mesure le degré d’intégration de l’activité.',
    },
    {
      code: 'taux_ebe',
      libelle: 'Taux d’excédent brut d’exploitation',
      valeurs: parCa(e.sig.map((s) => s.excedentBrutExploitation)),
      unite: '%',
      aide: 'Rentabilité de l’exploitation avant amortissements et frais financiers. C’est le premier indicateur regardé par un banquier.',
    },
    {
      code: 'taux_resultat_net',
      libelle: 'Taux de résultat net',
      valeurs: parCa(e.comptes.map((c) => c.resultatNet)),
      unite: '%',
      aide: 'Bénéfice net rapporté au chiffre d’affaires.',
    },
    {
      code: 'poids_personnel',
      libelle: 'Poids des charges de personnel',
      valeurs: parCa(e.sig.map((s) => s.chargesPersonnel)),
      unite: '%',
      aide: 'Masse salariale chargée rapportée au chiffre d’affaires.',
    },
    {
      code: 'poids_charges_externes',
      libelle: 'Poids des charges externes',
      valeurs: parCa(e.sig.map((s) => s.consommationsExterieures)),
      unite: '%',
      aide: 'Consommations en provenance de tiers rapportées au chiffre d’affaires.',
    },
    {
      code: 'rentabilite_capitaux_propres',
      libelle: 'Rentabilité des capitaux propres',
      valeurs: Array.from({ length: n }, (_, i) =>
        euro(div(e.comptes[i]?.resultatNet ?? 0, e.capitauxPropres[i] ?? 0) * 100),
      ),
      unite: '%',
      aide: 'Résultat net rapporté aux capitaux propres. Mesure le rendement des fonds investis par les associés.',
    },
    {
      code: 'capacite_remboursement',
      libelle: 'Capacité de remboursement',
      valeurs: Array.from({ length: n }, (_, i) =>
        euro(div(e.dettesFinancieres[i] ?? 0, e.caf[i]?.caf ?? 0)),
      ),
      unite: 'x',
      aide: 'Nombre d’années de capacité d’autofinancement nécessaires pour rembourser les dettes financières. Au-delà de 5, un banquier s’inquiète.',
    },
    {
      code: 'taux_endettement',
      libelle: 'Taux d’endettement',
      valeurs: Array.from({ length: n }, (_, i) =>
        euro(div(e.dettesFinancieres[i] ?? 0, e.capitauxPropres[i] ?? 0) * 100),
      ),
      unite: '%',
      aide: 'Dettes financières rapportées aux capitaux propres. Au-delà de 100 %, l’endettement dépasse les fonds propres.',
    },
    {
      code: 'couverture_service_dette',
      libelle: 'Couverture du service de la dette',
      valeurs: Array.from({ length: n }, (_, i) => euro(div(e.caf[i]?.caf ?? 0, e.annuites[i] ?? 0))),
      unite: 'x',
      aide: 'Capacité d’autofinancement rapportée aux annuités d’emprunt. Doit rester supérieure à 1,2 pour qu’un financement soit accordé.',
    },
    {
      code: 'bfr_jours',
      libelle: 'Besoin en fonds de roulement',
      valeurs: Array.from({ length: n }, (_, i) =>
        Math.round(div(e.bfr[i] ?? 0, e.chiffreAffaires[i] ?? 0) * (e.nbJoursParExercice[i] ?? 360)),
      ),
      unite: 'jours',
      aide: 'Besoin de financement du cycle d’exploitation, exprimé en jours de chiffre d’affaires.',
    },
    {
      code: 'rotation_stock',
      libelle: 'Rotation du stock',
      valeurs: Array.from({ length: n }, (_, i) =>
        Math.round(div(e.stocks[i] ?? 0, e.achatsConsommes[i] ?? 0) * (e.nbJoursParExercice[i] ?? 360)),
      ),
      unite: 'jours',
      aide: 'Durée moyenne de détention du stock, exprimée en jours d’achats consommés.',
    },
  ];

  return ratios.map((r) => ({ ...r, valeurs: r.valeurs.map((v) => (Number.isFinite(v) ? v : 0)) }));
}

/** Compte de résultat vierge d'un exercice. */
export function compteResultatVide(exercice: number): CompteResultat {
  return {
    exercice,
    ventesMarchandises: 0,
    production: 0,
    chiffreAffaires: 0,
    subventionsExploitation: 0,
    autresProduits: 0,
    totalProduitsExploitation: 0,
    achatsMarchandises: 0,
    variationStock: 0,
    achatsMatieres: 0,
    autresAchats: 0,
    sousTraitance: 0,
    servicesExterieurs: 0,
    autresServicesExterieurs: 0,
    impotsTaxes: 0,
    salairesBruts: 0,
    chargesSociales: 0,
    dotationsAmortissements: 0,
    autresCharges: 0,
    totalChargesExploitation: 0,
    resultatExploitation: 0,
    produitsFinanciers: 0,
    chargesFinancieres: 0,
    resultatFinancier: 0,
    resultatCourant: 0,
    produitsExceptionnels: 0,
    chargesExceptionnelles: 0,
    resultatExceptionnel: 0,
    resultatAvantImpot: 0,
    impotSocietes: 0,
    impotRevenuEstime: 0,
    resultatNet: 0,
  };
}

/** Nombre de jours conventionnel d'un exercice, base 30 jours par mois. */
export function joursExercice(nbMois: number): number {
  return nbMois * 30;
}

/** Tableau de zéros de la longueur voulue, exporté pour les constructeurs d'états. */
export const tableauVide = zeros;

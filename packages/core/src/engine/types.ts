import type { Anomalie } from '../model/dossier.js';

/** Un exercice du prévisionnel, avec ses bornes et son libellé d'affichage. */
export interface Exercice {
  /** 0 pour le premier exercice. */
  index: number;
  /** « 2026 » pour un exercice civil, « 2026-2027 » pour un exercice décalé. */
  libelle: string;
  /** Premier mois de l'exercice, en index absolu depuis le début du prévisionnel (0-based). */
  moisDebutAbsolu: number;
  nbMois: number;
  dateDebut: string;
  dateFin: string;
}

/** Une échéance d'emprunt. */
export interface EcheanceEmprunt {
  /** Index absolu du mois depuis le début du prévisionnel (0-based). */
  moisAbsolu: number;
  exercice: number;
  capitalDebut: number;
  echeance: number;
  interets: number;
  capital: number;
  assurance: number;
  capitalRestantDu: number;
}

export interface AmortissementEmprunt {
  empruntId: string;
  libelle: string;
  montant: number;
  tauxAnnuel: number;
  dureeMois: number;
  /** Mensualité hors assurance, hors période de différé. */
  mensualite: number;
  echeances: EcheanceEmprunt[];
  /** Agrégats par exercice. */
  parExercice: Array<{
    interets: number;
    capital: number;
    assurance: number;
    capitalRestantDuFin: number;
  }>;
}

/** Plan d'amortissement d'une immobilisation. */
export interface AmortissementImmobilisation {
  investissementId: string;
  libelle: string;
  categorie: string;
  base: number;
  dureeAnnees: number;
  /** Dotation par exercice du prévisionnel. */
  dotations: number[];
  /** Amortissements cumulés à la clôture de chaque exercice. */
  cumules: number[];
  /** Valeur nette comptable à la clôture de chaque exercice. */
  vnc: number[];
}

/** Ventilation mensuelle d'un flux : un montant par mois absolu du prévisionnel. */
export type SerieMensuelle = number[];

export interface DetailRecette {
  ligneId: string;
  libelle: string;
  nature: string;
  /** Chiffre d'affaires HT par exercice. */
  montants: number[];
  /** Ventilation mensuelle du chiffre d'affaires HT. */
  mensuel: SerieMensuelle;
  tauxTva: number;
}

export interface DetailCharge {
  ligneId: string;
  libelle: string;
  categorie: string;
  fixe: boolean;
  montants: number[];
  mensuel: SerieMensuelle;
  tauxTva: number;
  tvaDeductible: boolean;
}

export interface DetailPersonnel {
  ligneId: string;
  libelle: string;
  statut: string;
  /** Masse salariale brute (ou rémunération du dirigeant) par exercice. */
  brut: number[];
  /** Charges patronales ou cotisations TNS par exercice, nettes des aides. */
  charges: number[];
  /** Net versé, à titre indicatif. */
  net: number[];
  brutMensuel: SerieMensuelle;
  chargesMensuel: SerieMensuelle;
  /** Vrai si la rémunération n'est pas déductible du résultat (exploitant BNC / BIC). */
  nonDeductible: boolean;
}

/** Compte de résultat d'un exercice, en euros. */
export interface CompteResultat {
  exercice: number;

  ventesMarchandises: number;
  production: number;
  chiffreAffaires: number;
  subventionsExploitation: number;
  autresProduits: number;
  totalProduitsExploitation: number;

  achatsMarchandises: number;
  variationStock: number;
  achatsMatieres: number;
  autresAchats: number;
  sousTraitance: number;
  servicesExterieurs: number;
  autresServicesExterieurs: number;
  impotsTaxes: number;
  salairesBruts: number;
  chargesSociales: number;
  dotationsAmortissements: number;
  autresCharges: number;
  totalChargesExploitation: number;

  resultatExploitation: number;

  produitsFinanciers: number;
  chargesFinancieres: number;
  resultatFinancier: number;

  resultatCourant: number;

  produitsExceptionnels: number;
  chargesExceptionnelles: number;
  resultatExceptionnel: number;

  resultatAvantImpot: number;
  impotSocietes: number;
  /** Impôt sur le revenu estimé (BNC / BIC), présenté hors résultat comptable. */
  impotRevenuEstime: number;
  resultatNet: number;
}

/** Soldes intermédiaires de gestion. */
export interface Sig {
  exercice: number;
  margeCommerciale: number;
  production: number;
  margeGlobale: number;
  consommationsExterieures: number;
  valeurAjoutee: number;
  subventions: number;
  impotsTaxes: number;
  chargesPersonnel: number;
  excedentBrutExploitation: number;
  dotations: number;
  resultatExploitation: number;
  resultatCourant: number;
  resultatExceptionnel: number;
  impots: number;
  resultatNet: number;
}

export interface Caf {
  exercice: number;
  resultatNet: number;
  dotations: number;
  repriseSubventions: number;
  plusValuesCession: number;
  caf: number;
  /** CAF diminuée des remboursements d'emprunts en capital. */
  autofinancementNet: number;
}

export interface Ratio {
  code: string;
  libelle: string;
  /** Valeur par exercice. */
  valeurs: number[];
  unite: '€' | '%' | 'jours' | 'x';
  /** Commentaire d'interprétation affiché dans l'interface. */
  aide?: string;
}

export interface SeuilRentabilite {
  exercice: number;
  chiffreAffaires: number;
  chargesVariables: number;
  margeSurCoutVariable: number;
  tauxMargeSurCoutVariable: number;
  chargesFixes: number;
  /** Seuil de rentabilité économique. */
  seuil: number;
  /** Seuil incluant les remboursements d'emprunts en capital. */
  seuilFinancier: number;
  pointMortJours: number;
  margeSecurite: number;
  atteint: boolean;
}

export interface Bfr {
  exercice: number;
  stocks: number;
  creancesClients: number;
  creditTva: number;
  autresCreances: number;
  totalBesoins: number;
  dettesFournisseurs: number;
  tvaADecaisser: number;
  dettesSociales: number;
  dettesFiscales: number;
  autresDettes: number;
  totalRessources: number;
  bfr: number;
  variation: number;
  /** BFR exprimé en jours de chiffre d'affaires. */
  enJoursCA: number;
}

export interface PlanFinancement {
  exercice: number;
  besoins: {
    investissements: number;
    remboursementsEmprunts: number;
    remboursementsComptesCourants: number;
    variationBfr: number;
    distributions: number;
    total: number;
  };
  ressources: {
    caf: number;
    apports: number;
    emprunts: number;
    subventions: number;
    cessions: number;
    total: number;
  };
  solde: number;
  soldeCumule: number;
}

export interface MoisTresorerie {
  moisAbsolu: number;
  exercice: number;
  /** « janv. 2026 ». */
  libelle: string;
  soldeInitial: number;
  encaissements: {
    ventes: number;
    apports: number;
    emprunts: number;
    subventions: number;
    cessions: number;
    tvaRemboursee: number;
    autres: number;
    total: number;
  };
  decaissements: {
    achatsEtCharges: number;
    salaires: number;
    chargesSociales: number;
    investissements: number;
    echeancesEmprunts: number;
    tva: number;
    impots: number;
    distributions: number;
    autres: number;
    total: number;
  };
  variation: number;
  soldeFinal: number;
}

export interface PeriodeTva {
  moisAbsolu: number;
  exercice: number;
  libelle: string;
  collectee: number;
  deductibleBiensServices: number;
  deductibleImmobilisations: number;
  /** Positif = TVA à décaisser ; négatif = crédit de TVA. */
  solde: number;
  creditReporte: number;
  aDecaisser: number;
  /** Mois absolu de décaissement effectif. */
  moisDecaissement: number;
}

export interface Bilan {
  exercice: number;
  actif: {
    immobilisationsIncorporelles: number;
    immobilisationsCorporelles: number;
    immobilisationsFinancieres: number;
    amortissements: number;
    immobilisationsNettes: number;
    stocks: number;
    creancesClients: number;
    autresCreances: number;
    disponibilites: number;
    total: number;
  };
  passif: {
    capitalSocial: number;
    primesEtReserves: number;
    reportANouveau: number;
    resultatExercice: number;
    subventionsInvestissement: number;
    capitauxPropres: number;
    comptesCourants: number;
    empruntsDettesFinancieres: number;
    dettesFournisseurs: number;
    dettesFiscalesSociales: number;
    autresDettes: number;
    total: number;
  };
  ecart: number;
}

/** Résultat d'un contrôle de cohérence obligatoire avant export. */
export interface Controle {
  code: string;
  libelle: string;
  ok: boolean;
  /** Écart constaté, en euros. */
  ecart: number;
  exercice?: number;
  message: string;
  gravite: 'erreur' | 'avertissement';
}

/** Ensemble des résultats calculés à partir d'un dossier. */
export interface Resultats {
  exercices: Exercice[];
  /** Nombre total de mois couverts par le prévisionnel. */
  nbMois: number;
  /** Libellé de chaque mois absolu, « janv. 2026 ». */
  libellesMois: string[];

  amortissements: AmortissementImmobilisation[];
  emprunts: AmortissementEmprunt[];

  recettes: {
    detail: DetailRecette[];
    caParExercice: number[];
    caMensuel: SerieMensuelle;
  };
  charges: {
    detail: DetailCharge[];
    personnel: DetailPersonnel[];
    totalParExercice: number[];
  };

  compteResultat: CompteResultat[];
  sig: Sig[];
  caf: Caf[];
  ratios: Ratio[];
  seuilRentabilite: SeuilRentabilite[];
  bfr: Bfr[];
  planFinancement: PlanFinancement[];
  tresorerie: {
    mensuelle: MoisTresorerie[];
    soldeFinParExercice: number[];
    soldeMinimum: number;
    moisSoldeMinimum: number;
  };
  tva: {
    periodes: PeriodeTva[];
    parExercice: Array<{ collectee: number; deductible: number; due: number }>;
  };
  bilans: Bilan[];

  controles: Controle[];
  anomalies: Anomalie[];
  /** Faux si au moins un contrôle de gravité « erreur » a échoué. */
  coherent: boolean;
}

/** Vue réduite des déclarations de TVA, suffisante pour les contrôles de cohérence. */
export interface ResultatTvaControle {
  periodes: readonly PeriodeTva[];
}

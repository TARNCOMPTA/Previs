import type { Anomalie } from '../model/dossier.js';
import type {
  Bfr,
  Bilan,
  Caf,
  CompteResultat,
  Controle,
  Exercice,
  MoisTresorerie,
  PlanFinancement,
  ResultatTvaControle,
} from './types.js';
import { euro } from './utils.js';

/** Écart maximal toléré sur un contrôle, en euros. */
export const TOLERANCE = 1;

export interface EntreesControles {
  exercices: readonly Exercice[];
  bilans: readonly Bilan[];
  bfr: readonly Bfr[];
  comptes: readonly CompteResultat[];
  caf: readonly Caf[];
  planFinancement: readonly PlanFinancement[];
  tresorerie: readonly MoisTresorerie[];
  tva: ResultatTvaControle;
  /** Dotations aux amortissements par exercice, pour vérifier le cumul au bilan. */
  dotations: readonly number[];
  /** Amortissements sortis de l'actif par cession, cumulés. */
  amortSortiCumule: readonly number[];
  /** Écart constaté sur le bilan d'ouverture, non corrigé volontairement. */
  ecartOuverture: number;
  /** Solde de trésorerie au premier jour du prévisionnel. */
  tresorerieInitiale: number;
  /** Capacité de remboursement par exercice, en années. */
  capaciteRemboursement: readonly number[];
  /** Seuil de rentabilité atteint, par exercice. */
  seuilAtteint: readonly boolean[];
  /** Total des besoins et des ressources au démarrage. */
  besoinsDemarrage: number;
  ressourcesDemarrage: number;
}

function controle(
  code: string,
  libelle: string,
  ecart: number,
  message: string,
  exercice?: number,
  gravite: 'erreur' | 'avertissement' = 'erreur',
): Controle {
  return {
    code,
    libelle,
    ok: Math.abs(ecart) <= TOLERANCE,
    ecart: euro(ecart),
    exercice,
    message,
    gravite,
  };
}

/**
 * Contrôles obligatoires avant transmission d'un dossier.
 *
 * Un écart n'est jamais corrigé automatiquement ni absorbé par un compte d'attente :
 * il est signalé tel quel, avec son montant et l'exercice concerné, pour que la cause
 * soit identifiée et corrigée à la source.
 */
export function construireControles(e: EntreesControles): Controle[] {
  const controles: Controle[] = [];

  // 1. Équilibre du bilan.
  for (const b of e.bilans) {
    controles.push(
      controle(
        'bilan_equilibre',
        'Équilibre du bilan',
        b.ecart,
        b.ecart === 0
          ? `Le bilan de l’exercice ${e.exercices[b.exercice]?.libelle ?? b.exercice + 1} équilibre.`
          : `Le total de l’actif et celui du passif diffèrent de ${euro(b.ecart)} €. Vérifier les postes du besoin en fonds de roulement et les flux de trésorerie.`,
        b.exercice,
      ),
    );
  }

  // 2. Cohérence entre le besoin en fonds de roulement et le bilan.
  for (let i = 0; i < e.bilans.length; i++) {
    const b = e.bilans[i];
    const f = e.bfr[i];
    if (!b || !f) continue;
    const actifCirculantBilan = euro(b.actif.stocks + b.actif.creancesClients + b.actif.autresCreances);
    const actifCirculantBfr = euro(f.stocks + f.creancesClients + f.creditTva + f.autresCreances);
    const passifExploitationBilan = euro(
      b.passif.dettesFournisseurs + b.passif.dettesFiscalesSociales + b.passif.autresDettes,
    );
    const passifExploitationBfr = euro(
      f.dettesFournisseurs + f.tvaADecaisser + f.dettesSociales + f.dettesFiscales + f.autresDettes,
    );
    const ecart = euro(
      actifCirculantBilan - actifCirculantBfr - (passifExploitationBilan - passifExploitationBfr),
    );
    controles.push(
      controle(
        'bfr_bilan',
        'Cohérence du besoin en fonds de roulement et du bilan',
        ecart,
        ecart === 0
          ? 'Les postes d’exploitation du bilan figurent tous dans le besoin en fonds de roulement.'
          : `Un poste d’exploitation figure au bilan sans être repris dans le besoin en fonds de roulement, pour ${euro(ecart)} €. C’est la cause la plus fréquente d’un bilan déséquilibré.`,
        i,
      ),
    );
  }

  // 3. Cohérence entre le plan de financement et la trésorerie.
  for (let i = 0; i < e.planFinancement.length; i++) {
    const p = e.planFinancement[i];
    const ex = e.exercices[i];
    if (!p || !ex) continue;
    const debut = ex.moisDebutAbsolu;
    const fin = debut + ex.nbMois - 1;
    const soldeDebut = e.tresorerie[debut]?.soldeInitial ?? e.tresorerieInitiale;
    const soldeFin = e.tresorerie[fin]?.soldeFinal ?? soldeDebut;
    const variationConstatee = euro(soldeFin - soldeDebut);
    const ecart = euro(variationConstatee - p.solde);
    controles.push(
      controle(
        'plan_tresorerie',
        'Cohérence du plan de financement et de la trésorerie',
        ecart,
        ecart === 0
          ? 'La variation de trésorerie de l’exercice correspond au solde du plan de financement.'
          : `Le plan de financement annonce une variation de trésorerie de ${euro(p.solde)} € alors que le tableau mensuel en constate ${variationConstatee} €, soit ${euro(ecart)} € d’écart.`,
        i,
      ),
    );
  }

  // 4. Cohérence du compte de résultat et du bilan.
  let cumulDotations = 0;
  for (let i = 0; i < e.comptes.length; i++) {
    const c = e.comptes[i];
    const b = e.bilans[i];
    if (!c || !b) continue;

    controles.push(
      controle(
        'resultat_bilan',
        'Report du résultat au bilan',
        euro(c.resultatNet - b.passif.resultatExercice),
        'Le résultat net du compte de résultat doit être identique au résultat porté au bilan.',
        i,
      ),
    );

    cumulDotations = euro(cumulDotations + (e.dotations[i] ?? 0));
    const attendu = euro(cumulDotations - (e.amortSortiCumule[i] ?? 0));
    controles.push(
      controle(
        'amortissements_cumules',
        'Cumul des amortissements au bilan',
        euro(attendu - b.actif.amortissements),
        'Les amortissements cumulés au bilan doivent égaler la somme des dotations des exercices écoulés, diminuée de celles sorties par cession.',
        i,
      ),
    );
  }

  // 5. Cohérence de la TVA.
  for (const p of e.tva.periodes) {
    const ecart = euro(p.collectee - p.deductibleBiensServices - p.deductibleImmobilisations - p.solde);
    if (Math.abs(ecart) > TOLERANCE) {
      controles.push(
        controle(
          'tva_periode',
          `Cohérence de la TVA — ${p.libelle}`,
          ecart,
          'La TVA collectée diminuée de la TVA déductible doit égaler le solde de la déclaration.',
          p.exercice,
        ),
      );
    }
  }
  if (e.tva.periodes.length > 0) {
    const collectee = e.tva.periodes.reduce((t, p) => t + p.collectee, 0);
    const deductible = e.tva.periodes.reduce(
      (t, p) => t + p.deductibleBiensServices + p.deductibleImmobilisations,
      0,
    );
    const solde = e.tva.periodes.reduce((t, p) => t + p.solde, 0);
    controles.push(
      controle(
        'tva_annuelle',
        'Cohérence de la TVA sur l’ensemble de la période',
        euro(collectee - deductible - solde),
        'Le cumul des déclarations de TVA doit être cohérent avec la TVA collectée et déductible de la période.',
      ),
    );
  }

  // Bilan d'ouverture, quand le dossier en comporte un.
  if (Math.abs(e.ecartOuverture) > TOLERANCE) {
    controles.push(
      controle(
        'bilan_ouverture',
        'Équilibre du bilan d’ouverture',
        e.ecartOuverture,
        `Le bilan d’ouverture saisi présente un écart de ${euro(e.ecartOuverture)} € entre l’actif et le passif. Cet écart se propage à tous les exercices : il doit être corrigé dans la section Autres.`,
      ),
    );
  }

  // ─── Avertissements : ils n'invalident pas le dossier mais méritent un regard ───

  const moisNegatifs = e.tresorerie.filter((m) => m.soldeFinal < 0);
  if (moisNegatifs.length > 0) {
    const pire = moisNegatifs.reduce((a, b) => (b.soldeFinal < a.soldeFinal ? b : a));
    controles.push({
      code: 'tresorerie_negative',
      libelle: 'Trésorerie négative',
      ok: false,
      ecart: euro(pire.soldeFinal),
      exercice: pire.exercice,
      message: `La trésorerie devient négative sur ${moisNegatifs.length} mois, au plus bas en ${pire.libelle} avec ${euro(pire.soldeFinal)} €. Prévoir un financement complémentaire ou un découvert autorisé.`,
      gravite: 'avertissement',
    });
  }

  const ecartDemarrage = euro(e.ressourcesDemarrage - e.besoinsDemarrage);
  if (ecartDemarrage < -TOLERANCE) {
    controles.push({
      code: 'financement_demarrage',
      libelle: 'Écart de financement au démarrage',
      ok: false,
      ecart: ecartDemarrage,
      exercice: 0,
      message: `Les ressources du premier exercice couvrent ${e.ressourcesDemarrage} € pour ${e.besoinsDemarrage} € de besoins, soit ${euro(-ecartDemarrage)} € manquants.`,
      gravite: 'avertissement',
    });
  }

  for (let i = 0; i < e.capaciteRemboursement.length; i++) {
    const capacite = e.capaciteRemboursement[i];
    if (capacite > 5) {
      controles.push({
        code: 'capacite_remboursement',
        libelle: 'Capacité de remboursement dégradée',
        ok: false,
        ecart: euro(capacite),
        exercice: i,
        message: `Il faudrait ${euro(capacite)} années de capacité d’autofinancement pour rembourser les dettes financières de l’exercice ${e.exercices[i]?.libelle ?? i + 1}. Au-delà de 5 ans, un établissement bancaire refuse généralement le concours.`,
        gravite: 'avertissement',
      });
    }
  }

  for (let i = 0; i < e.seuilAtteint.length; i++) {
    if (!e.seuilAtteint[i] && (e.comptes[i]?.chiffreAffaires ?? 0) > 0) {
      controles.push({
        code: 'seuil_non_atteint',
        libelle: 'Seuil de rentabilité non atteint',
        ok: false,
        ecart: 0,
        exercice: i,
        message: `Le chiffre d’affaires de l’exercice ${e.exercices[i]?.libelle ?? i + 1} ne couvre pas les charges fixes.`,
        gravite: 'avertissement',
      });
    }
  }

  for (const b of e.bilans) {
    const cp = b.passif.capitauxPropres;
    if (cp < 0) {
      controles.push({
        code: 'capitaux_propres_negatifs',
        libelle: 'Capitaux propres négatifs',
        ok: false,
        ecart: euro(cp),
        exercice: b.exercice,
        message: `Les capitaux propres sont négatifs de ${euro(-cp)} € à la clôture de l’exercice ${e.exercices[b.exercice]?.libelle ?? b.exercice + 1}.`,
        gravite: 'avertissement',
      });
    }
  }

  return controles;
}

/** Anomalies de saisie détectées dans le dossier, sans incidence sur les calculs. */
export function detecterAnomalies(donnees: {
  nbRecettes: number;
  caTotal: number;
  empruntsSansMontant: string[];
  investissementsSansDuree: string[];
  personnelSansBrut: string[];
  chargesSansMontant: number;
  introductionVide: boolean;
  raisonSocialeVide: boolean;
}): Anomalie[] {
  const anomalies: Anomalie[] = [];

  if (donnees.raisonSocialeVide) {
    anomalies.push({
      code: 'identite_incomplete',
      gravite: 'avertissement',
      message: 'La raison sociale du dossier n’est pas renseignée.',
      chemin: 'identite.raisonSociale',
    });
  }
  if (donnees.nbRecettes === 0 || donnees.caTotal === 0) {
    anomalies.push({
      code: 'ca_absent',
      gravite: 'avertissement',
      message: 'Aucun chiffre d’affaires n’est saisi : tous les états resteront à zéro.',
      chemin: 'recettes.lignes',
    });
  }
  for (const libelle of donnees.empruntsSansMontant) {
    anomalies.push({
      code: 'emprunt_sans_montant',
      gravite: 'avertissement',
      message: `L’emprunt « ${libelle} » n’a pas de montant : aucune échéance n’est calculée.`,
      chemin: 'financements.emprunts',
    });
  }
  for (const libelle of donnees.investissementsSansDuree) {
    anomalies.push({
      code: 'investissement_sans_duree',
      gravite: 'avertissement',
      message: `L’investissement « ${libelle} » est amortissable mais sans durée : aucune dotation n’est calculée.`,
      chemin: 'investissements.lignes',
    });
  }
  for (const libelle of donnees.personnelSansBrut) {
    anomalies.push({
      code: 'personnel_sans_remuneration',
      gravite: 'info',
      message: `Le poste « ${libelle} » n’a pas de rémunération saisie.`,
      chemin: 'charges.personnel',
    });
  }
  if (donnees.chargesSansMontant > 0) {
    anomalies.push({
      code: 'charges_a_zero',
      gravite: 'info',
      message: `${donnees.chargesSansMontant} ligne(s) de charges restent à zéro : elles n’apparaîtront pas dans le dossier remis.`,
      chemin: 'charges.lignes',
    });
  }
  if (donnees.introductionVide) {
    anomalies.push({
      code: 'introduction_vide',
      gravite: 'info',
      message: 'L’introduction du rapport n’est pas rédigée : la section correspondante sera omise du PDF.',
      chemin: 'identite.introduction',
    });
  }

  return anomalies;
}

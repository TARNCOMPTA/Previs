import { normaliserDossier, type Dossier } from '../src/model/dossier.js';
import type { RegimeFiscal } from '../src/model/identite.js';

/** Construit un dossier de test à partir d'un fragment, toutes valeurs par défaut appliquées. */
export function dossier(fragment: Record<string, unknown> = {}): Dossier {
  return normaliserDossier(fragment);
}

/** Dossier complet et réaliste, utilisé pour éprouver l'équilibre du bilan. */
export function dossierComplet(regime: RegimeFiscal): Dossier {
  const assujetti = regime !== 'BNC';
  const tauxTva = assujetti ? 20 : 0;

  return normaliserDossier({
    identite: {
      raisonSociale: regime === 'BNC' ? 'Cabinet infirmier MARTIN' : 'ATELIER DU TARN',
      formeJuridique: regime === 'IS' ? 'SAS' : regime === 'BNC' ? 'Entreprise individuelle' : 'Entreprise individuelle',
      regime,
      typeDossier: 'creation',
      activite: 'Activité de test',
      introduction: 'Un paragraphe.\n\nUn second paragraphe.',
    },
    parametres: {
      dateDebut: '2026-01-01',
      nbExercices: 3,
      dureePremierExerciceMois: 12,
      tresorerieInitiale: 5000,
      cfe: [0, 900, 950],
      tva: {
        assujetti,
        regime: assujetti ? 'mensuel' : 'franchise',
        tauxParDefaut: tauxTva,
        decalageDecaissementMois: 1,
        creditReportable: true,
      },
      bfr: {
        delaiClientsJours: 45,
        delaiFournisseursJours: 30,
        rotationStockJours: regime === 'BNC' ? 0 : 30,
        partComptantPourcent: 20,
      },
      social: { tauxChargesPatronales: 42, tauxChargesSalariales: 22, periodicite: 'mensuelle', decalageMois: 1 },
      tns: { tauxCotisations: 45, cotisationsMinimales: 1100, assietteResultatAvantCotisations: true, periodicite: 'trimestrielle' },
      is: { tauxReduit: 15, plafondTauxReduit: 42500, tauxNormal: 25, eligibleTauxReduit: true, decalagePaiementMois: 4, acomptes: false },
      ir: { tauxMoyen: regime === 'IS' ? 0 : 15, decaisse: false },
    },
    investissements: {
      lignes: [
        {
          id: 'inv1', libelle: 'Matériel professionnel', categorie: 'corporel',
          montantHT: 45000, tauxTva, tvaRecuperable: assujetti,
          exercice: 0, mois: 1, modeAmortissement: 'lineaire', dureeAmortissementAnnees: 5,
        },
        {
          id: 'inv2', libelle: 'Véhicule utilitaire', categorie: 'corporel',
          montantHT: 24000, tauxTva, tvaRecuperable: assujetti,
          exercice: 0, mois: 3, modeAmortissement: 'degressif', dureeAmortissementAnnees: 5,
          echelonnementMois: 3,
        },
        {
          id: 'inv3', libelle: 'Logiciel de gestion', categorie: 'incorporel',
          montantHT: 6000, tauxTva, tvaRecuperable: assujetti,
          exercice: 0, mois: 2, modeAmortissement: 'lineaire', dureeAmortissementAnnees: 3,
        },
        ...(regime === 'BNC' ? [] : [{
          id: 'inv4', libelle: 'Stock de départ', categorie: 'stock_initial',
          montantHT: 12000, tauxTva, tvaRecuperable: assujetti,
          exercice: 0, mois: 1, modeAmortissement: 'aucun', dureeAmortissementAnnees: 0,
        }]),
        {
          id: 'inv5', libelle: 'Trésorerie de démarrage', categorie: 'tresorerie_demarrage',
          montantHT: 10000, tauxTva: 0, tvaRecuperable: false,
          exercice: 0, mois: 1, modeAmortissement: 'aucun', dureeAmortissementAnnees: 0,
        },
      ],
      cessions: [
        {
          id: 'ces1', libelle: 'Revente du véhicule', investissementId: 'inv2',
          exercice: 2, mois: 10, prixCessionHT: 9000, tauxTva,
        },
      ],
    },
    financements: {
      apports: [
        { id: 'ap1', libelle: 'Capital social', type: regime === 'IS' ? 'capital' : 'apport_personnel', apporteur: 'Associés', montant: 30000, exercice: 0, mois: 1 },
        { id: 'ap2', libelle: 'Compte courant', type: 'compte_courant', apporteur: 'Dirigeant', montant: 15000, exercice: 0, mois: 1, remboursements: [0, 5000, 5000] },
      ],
      emprunts: [
        {
          id: 'emp1', libelle: 'Prêt bancaire', organisme: 'Crédit Agricole',
          montant: 60000, tauxAnnuel: 3.2, dureeMois: 84, exerciceDeblocage: 0, moisDeblocage: 1,
          periodicite: 'mensuelle', typeDiffere: 'partiel', differeMois: 6,
          tauxAssuranceAnnuel: 0.36, fraisDossier: 450, fraisGarantie: 600,
        },
      ],
      subventions: [
        { id: 'sub1', libelle: 'Subvention Région', organisme: 'Région Occitanie', type: 'investissement', montant: 9000, exercice: 0, mois: 4, repriseSurAnnees: 5 },
      ],
      creditsBaux: [
        {
          id: 'cb1', libelle: 'Crédit-bail machine', organisme: 'BNP Leasing',
          valeurBien: 30000, loyerMensuelHT: 550, dureeMois: 48,
          exerciceDebut: 0, moisDebut: 2, depotGarantie: 1650, valeurResiduelle: 0, tauxTva,
        },
      ],
    },
    recettes: {
      lignes: [
        ...(regime === 'BNC'
          ? [{
              id: 'rec1', libelle: 'Honoraires', nature: 'honoraires', mode: 'croissance',
              base: 92000, tauxCroissance: [0, 8, 6], tauxTva: 0,
              repartition: { type: 'saisonnalite', poids: [9, 9, 9, 8, 8, 7, 5, 5, 8, 9, 9, 9] },
            }]
          : [
              {
                id: 'rec1', libelle: 'Ventes en atelier', nature: 'vente_marchandises', mode: 'montants',
                montants: [140000, 168000, 185000], tauxTva, tauxAchatsLiesPourcent: 38,
                repartition: { type: 'saisonnalite', poids: [7, 7, 8, 8, 9, 9, 6, 5, 9, 10, 11, 11] },
              },
              {
                id: 'rec2', libelle: 'Prestations de pose', nature: 'prestations', mode: 'volume_prix',
                quantites: [180, 220, 250], prixUnitaire: [320, 330, 340], tauxTva,
                repartition: { type: 'lineaire' },
              },
            ]),
        { id: 'rec3', libelle: 'Aide à la création', nature: 'subvention_exploitation', mode: 'montants', montants: [3000, 0, 0], tauxTva: 0, repartition: { type: 'ponctuel', mois: 2 } },
      ],
    },
    charges: {
      lignes: [
        { id: 'ch1', libelle: 'Loyer du local', categorie: 'services_exterieurs', montants: [14400, 14400, 14832], tauxTva, tvaDeductible: assujetti, fixe: true, repartition: { type: 'lineaire' } },
        { id: 'ch2', libelle: 'Assurances', categorie: 'services_exterieurs', montants: [2400, 2500, 2600], tauxTva: 0, tvaDeductible: false, fixe: true, repartition: { type: 'lineaire' } },
        { id: 'ch3', libelle: 'Énergie', categorie: 'services_exterieurs', montants: [3600, 4000, 4200], tauxTva, tvaDeductible: assujetti, fixe: false, repartition: { type: 'saisonnalite', poids: [12, 11, 9, 7, 5, 4, 4, 4, 6, 9, 12, 13] } },
        { id: 'ch4', libelle: 'Honoraires comptables', categorie: 'autres_services_exterieurs', montants: [2800, 2900, 3000], tauxTva, tvaDeductible: assujetti, fixe: true, repartition: { type: 'lineaire' } },
        { id: 'ch5', libelle: 'Frais de déplacement', categorie: 'autres_services_exterieurs', mode: 'pourcentage_ca', pourcentages: [2.5, 2.5, 2.5], tauxTva, tvaDeductible: assujetti, fixe: false, repartition: { type: 'lineaire' } },
        { id: 'ch6', libelle: 'Frais bancaires', categorie: 'autres_services_exterieurs', montants: [480, 500, 520], tauxTva: 0, tvaDeductible: false, fixe: true, repartition: { type: 'lineaire' } },
      ],
      personnel:
        regime === 'IS'
          ? [
              { id: 'per1', libelle: 'Rémunération du dirigeant', statut: 'dirigeant_assimile', effectifs: [1, 1, 1], brutMensuel: [2400, 2600, 2800], nbMoisParExercice: [12, 12, 12], exerciceEmbauche: 0, moisEmbauche: 1 },
              { id: 'per2', libelle: 'Technicien', statut: 'salarie', effectifs: [1, 2, 2], brutMensuel: [2100, 2150, 2200], nbMoisParExercice: [12, 12, 12], primes: [0, 1500, 1800], exerciceEmbauche: 0, moisEmbauche: 4, aides: [2000, 0, 0] },
            ]
          : [
              { id: 'per1', libelle: 'Prélèvements de l’exploitant', statut: 'exploitant', effectifs: [1, 1, 1], brutMensuel: [2200, 2500, 2700], nbMoisParExercice: [12, 12, 12], exerciceEmbauche: 0, moisEmbauche: 1 },
              ...(regime === 'BIC_IR'
                ? [{ id: 'per2', libelle: 'Apprenti', statut: 'salarie', effectifs: [1, 1, 1], brutMensuel: [900, 950, 1000], nbMoisParExercice: [12, 12, 12], exerciceEmbauche: 0, moisEmbauche: 6 }]
                : []),
            ],
    },
    autres: {
      exceptionnels: [
        { id: 'exc1', libelle: 'Indemnité d’assurance', sens: 'produit', montants: [0, 2500, 0], tauxTva: 0, impacteTresorerie: true, repartition: { type: 'ponctuel', mois: 8 } },
        { id: 'exc2', libelle: 'Pénalité de retard', sens: 'charge', montants: [0, 0, 800], tauxTva: 0, impacteTresorerie: true, repartition: { type: 'ponctuel', mois: 5 } },
      ],
      distributions:
        regime === 'IS'
          ? [{ id: 'dis1', libelle: 'Dividendes', type: 'dividendes', montants: [0, 0, 6000], repartition: { type: 'ponctuel', mois: 6 } }]
          : [],
    },
  });
}

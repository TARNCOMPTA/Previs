import { nouvelId } from '../model/common.js';
import type { CategorieCharge } from '../model/charges.js';
import { normaliserDossier, type Dossier } from '../model/dossier.js';
import type { RegimeFiscal } from '../model/identite.js';

interface ModeleCharge {
  libelle: string;
  categorie: CategorieCharge;
  compte?: string;
  tauxTva?: number;
  tvaDeductible?: boolean;
  fixe?: boolean;
}

/**
 * Plans de charges usuels proposés à la création d'un dossier, par régime.
 *
 * Ces lignes sont créées à zéro : elles servent de trame de saisie pour ne rien
 * oublier, et non de chiffres présumés. Le LLM comme l'utilisateur les complètent
 * ensuite ; les lignes restées à zéro n'apparaissent pas dans le PDF.
 */
export const PLANS_CHARGES: Record<RegimeFiscal, ModeleCharge[]> = {
  IS: [
    { libelle: 'Achats de marchandises', categorie: 'achats_marchandises', compte: '607', fixe: false },
    { libelle: 'Fournitures et petits équipements', categorie: 'fournitures', compte: '6063' },
    { libelle: 'Sous-traitance', categorie: 'sous_traitance', compte: '604', fixe: false },
    { libelle: 'Loyers et charges locatives', categorie: 'services_exterieurs', compte: '613' },
    { libelle: 'Eau, électricité, gaz', categorie: 'services_exterieurs', compte: '606' },
    { libelle: 'Entretien et réparations', categorie: 'services_exterieurs', compte: '615' },
    { libelle: 'Assurances', categorie: 'services_exterieurs', compte: '616', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Honoraires comptables et juridiques', categorie: 'autres_services_exterieurs', compte: '6226' },
    { libelle: 'Publicité et communication', categorie: 'autres_services_exterieurs', compte: '623' },
    { libelle: 'Déplacements et missions', categorie: 'autres_services_exterieurs', compte: '625' },
    { libelle: 'Frais postaux et télécommunications', categorie: 'autres_services_exterieurs', compte: '626' },
    { libelle: 'Services bancaires', categorie: 'autres_services_exterieurs', compte: '627', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Cotisation foncière des entreprises', categorie: 'impots_taxes', compte: '63511', tauxTva: 0, tvaDeductible: false },
  ],
  BNC: [
    { libelle: 'Fournitures et petit matériel médical', categorie: 'fournitures', compte: '606' },
    { libelle: 'Loyer du cabinet', categorie: 'services_exterieurs', compte: '613' },
    { libelle: 'Redevance de collaboration', categorie: 'sous_traitance', compte: '604', fixe: false },
    { libelle: 'Véhicule — carburant et entretien', categorie: 'services_exterieurs', compte: '6061' },
    { libelle: 'Assurances (RCP, véhicule, local)', categorie: 'services_exterieurs', compte: '616', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Honoraires comptables', categorie: 'autres_services_exterieurs', compte: '6226' },
    { libelle: 'Cotisations professionnelles et ordinales', categorie: 'autres_services_exterieurs', compte: '6281', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Frais de télétransmission et logiciels', categorie: 'autres_services_exterieurs', compte: '6183' },
    { libelle: 'Téléphone et internet', categorie: 'autres_services_exterieurs', compte: '626' },
    { libelle: 'Frais bancaires', categorie: 'autres_services_exterieurs', compte: '627', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Cotisation foncière des entreprises', categorie: 'impots_taxes', compte: '63511', tauxTva: 0, tvaDeductible: false },
  ],
  BIC_IR: [
    { libelle: 'Achats de marchandises', categorie: 'achats_marchandises', compte: '607', fixe: false },
    { libelle: 'Achats de matières premières', categorie: 'achats_matieres', compte: '601', fixe: false },
    { libelle: 'Fournitures et petits équipements', categorie: 'fournitures', compte: '6063' },
    { libelle: 'Loyers et charges locatives', categorie: 'services_exterieurs', compte: '613' },
    { libelle: 'Eau, électricité, gaz', categorie: 'services_exterieurs', compte: '606' },
    { libelle: 'Véhicule — carburant et entretien', categorie: 'services_exterieurs', compte: '6061' },
    { libelle: 'Assurances', categorie: 'services_exterieurs', compte: '616', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Honoraires comptables', categorie: 'autres_services_exterieurs', compte: '6226' },
    { libelle: 'Publicité et communication', categorie: 'autres_services_exterieurs', compte: '623' },
    { libelle: 'Téléphone et internet', categorie: 'autres_services_exterieurs', compte: '626' },
    { libelle: 'Frais bancaires', categorie: 'autres_services_exterieurs', compte: '627', tauxTva: 0, tvaDeductible: false },
    { libelle: 'Cotisation foncière des entreprises', categorie: 'impots_taxes', compte: '63511', tauxTva: 0, tvaDeductible: false },
  ],
};

/** Recettes types proposées à la création, par régime. */
const RECETTES_TYPES: Record<RegimeFiscal, Array<{ libelle: string; nature: string; tauxTva: number }>> = {
  IS: [{ libelle: 'Activité principale', nature: 'prestations', tauxTva: 20 }],
  BNC: [{ libelle: 'Honoraires', nature: 'honoraires', tauxTva: 0 }],
  BIC_IR: [{ libelle: 'Ventes', nature: 'vente_marchandises', tauxTva: 20 }],
};

/** Personnel type proposé à la création, par régime. */
const PERSONNEL_TYPE: Record<RegimeFiscal, Array<{ libelle: string; statut: string }>> = {
  IS: [{ libelle: 'Rémunération du dirigeant', statut: 'dirigeant_assimile' }],
  BNC: [{ libelle: 'Prélèvements et cotisations du praticien', statut: 'exploitant' }],
  BIC_IR: [{ libelle: 'Prélèvements et cotisations de l’exploitant', statut: 'exploitant' }],
};

/**
 * Crée un dossier pré-structuré pour un régime donné : paramètres fiscaux adaptés
 * et trame de saisie (charges, recettes, personnel) à compléter.
 */
export function modeleDossier(regime: RegimeFiscal, anneeDebut = 2026): Dossier {
  const brut: Record<string, unknown> = {
    identite: { regime, typeDossier: 'creation' },
    parametres: {
      dateDebut: `${anneeDebut}-01-01`,
      nbExercices: 3,
      dureePremierExerciceMois: 12,
      // Les professions médicales sont exonérées de TVA (article 261, 4-1° du CGI).
      tva: regime === 'BNC'
        ? { assujetti: false, regime: 'franchise', tauxParDefaut: 0 }
        : { assujetti: true, regime: 'mensuel', tauxParDefaut: 20 },
      ir: regime === 'IS' ? { tauxMoyen: 0 } : { tauxMoyen: 0, decaisse: false },
      bfr:
        regime === 'BNC'
          ? { delaiClientsJours: 15, delaiFournisseursJours: 30, rotationStockJours: 0 }
          : { delaiClientsJours: 30, delaiFournisseursJours: 30, rotationStockJours: 0 },
    },
    charges: {
      lignes: PLANS_CHARGES[regime].map((c) => ({
        id: nouvelId('chg'),
        libelle: c.libelle,
        categorie: c.categorie,
        compte: c.compte,
        tauxTva: c.tauxTva ?? (regime === 'BNC' ? 0 : 20),
        tvaDeductible: c.tvaDeductible ?? regime !== 'BNC',
        fixe: c.fixe ?? true,
        montants: [],
      })),
      personnel: PERSONNEL_TYPE[regime].map((p) => ({
        id: nouvelId('per'),
        libelle: p.libelle,
        statut: p.statut,
      })),
    },
    recettes: {
      lignes: RECETTES_TYPES[regime].map((r) => ({
        id: nouvelId('rec'),
        libelle: r.libelle,
        nature: r.nature,
        tauxTva: r.tauxTva,
        montants: [],
      })),
    },
  };

  return normaliserDossier(brut);
}

/** Libellés des modèles proposés dans l'écran de création. */
export const MODELES_DISPONIBLES: Array<{ cle: 'vide' | RegimeFiscal; libelle: string; description: string }> = [
  { cle: 'vide', libelle: 'Dossier vierge', description: 'Aucune ligne pré-remplie.' },
  {
    cle: 'IS',
    libelle: 'Société à l’IS',
    description: 'SAS, SARL, EURL : trame de charges, rémunération du dirigeant, TVA mensuelle.',
  },
  {
    cle: 'BNC',
    libelle: 'Profession libérale (BNC)',
    description: 'Infirmier, médecin, kiné : honoraires exonérés de TVA, cotisations TNS.',
  },
  {
    cle: 'BIC_IR',
    libelle: 'Entreprise individuelle (BIC)',
    description: 'Commerçant, artisan : ventes soumises à TVA, prélèvements de l’exploitant.',
  },
];

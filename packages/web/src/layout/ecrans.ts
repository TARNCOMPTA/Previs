import { lazy, type LazyExoticComponent } from 'react';

/**
 * Le registre des écrans d'un dossier : saisie d'un côté, états financiers de l'autre.
 *
 * Il existe pour que les trois endroits qui en ont besoin lisent la même liste : les routes
 * (App.tsx), la navigation latérale et les deux volets de la vue scindée. Auparavant les
 * routes et la navigation portaient chacune leur copie, et un écran ajouté d'un côté
 * n'apparaissait pas de l'autre.
 *
 * Les composants sont chargés à la demande, et par ce module seul : le volet de résultat et
 * la route pleine largeur d'un même état partagent donc le même module, jamais deux copies.
 */

export interface Ecran {
  /** Segment d'URL, relatif au dossier. */
  chemin: string;
  libelle: string;
  /** Libellé court, pour l'onglet d'un volet où la place manque. */
  court?: string;
  composant: LazyExoticComponent<() => JSX.Element>;
}

const TableauDeBord = lazy(() => import('../pages/TableauDeBord.js'));
const Investissements = lazy(() => import('../pages/sections/Investissements.js'));
const Financements = lazy(() => import('../pages/sections/Financements.js'));
const Charges = lazy(() => import('../pages/sections/Charges.js'));
const Recettes = lazy(() => import('../pages/sections/Recettes.js'));
const Autres = lazy(() => import('../pages/sections/Autres.js'));

/** Les six écrans de saisie, dans l'ordre où un dossier se remplit. */
export const SECTIONS: readonly Ecran[] = [
  { chemin: 'tableau-de-bord', libelle: 'Tableau de bord', court: 'Bord', composant: TableauDeBord },
  { chemin: 'investissements', libelle: 'Investissement', court: 'Invest.', composant: Investissements },
  { chemin: 'financements', libelle: 'Financement', court: 'Financ.', composant: Financements },
  { chemin: 'charges', libelle: 'Charges', composant: Charges },
  { chemin: 'recettes', libelle: 'Recettes', composant: Recettes },
  { chemin: 'autres', libelle: 'Autres', composant: Autres },
];

const CompteResultat = lazy(() => import('../pages/etats/CompteResultat.js'));
const Sig = lazy(() => import('../pages/etats/Sig.js'));
const Tresorerie = lazy(() => import('../pages/etats/Tresorerie.js'));
const PlanFinancement = lazy(() => import('../pages/etats/PlanFinancement.js'));
const Bilan = lazy(() => import('../pages/etats/Bilan.js'));
const Tva = lazy(() => import('../pages/etats/Tva.js'));
const Ratios = lazy(() => import('../pages/etats/Ratios.js'));
const Controles = lazy(() => import('../pages/etats/Controles.js'));

/** Les huit états financiers. Le chemin est relatif à « etats/ ». */
export const ETATS: readonly Ecran[] = [
  { chemin: 'compte-resultat', libelle: 'Compte de résultat', composant: CompteResultat },
  { chemin: 'sig', libelle: 'Soldes de gestion', composant: Sig },
  { chemin: 'tresorerie', libelle: 'Trésorerie', composant: Tresorerie },
  { chemin: 'plan-financement', libelle: 'Plan de financement', composant: PlanFinancement },
  { chemin: 'bilan', libelle: 'Bilan et BFR', composant: Bilan },
  { chemin: 'tva', libelle: 'TVA', composant: Tva },
  { chemin: 'ratios', libelle: 'Ratios et seuil', composant: Ratios },
  { chemin: 'controles', libelle: 'Contrôles', composant: Controles },
];

/**
 * L'état que la vue scindée ouvre à droite selon l'écran de saisie à gauche.
 *
 * Le rapprochement se lit dans les données, pas dans les noms : une immobilisation saisie
 * modifie d'abord le plan de financement, un financement aussi ; une charge ou une recette
 * se lit dans le compte de résultat ; le tableau de bord et l'écran « Autres », qui touchent
 * au besoin en fonds de roulement et au bilan d'ouverture, se lisent dans le bilan.
 */
const ETAT_LIE: Readonly<Record<string, string>> = {
  'tableau-de-bord': 'compte-resultat',
  investissements: 'plan-financement',
  financements: 'plan-financement',
  charges: 'compte-resultat',
  recettes: 'compte-resultat',
  autres: 'bilan',
};

/** L'état à ouvrir à droite pour un écran de saisie donné, avec un repli sûr. */
export function etatLie(cheminSection: string): string {
  return ETAT_LIE[cheminSection] ?? 'compte-resultat';
}

/** Retrouve un état par son chemin. Rend « undefined » pour un chemin inconnu. */
export function etatParChemin(chemin: string): Ecran | undefined {
  return ETATS.find((e) => e.chemin === chemin);
}

/** Retrouve un écran de saisie par son chemin. */
export function sectionParChemin(chemin: string): Ecran | undefined {
  return SECTIONS.find((s) => s.chemin === chemin);
}

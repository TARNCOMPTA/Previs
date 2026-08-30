import type { Dossier } from '../model/dossier.js';
import type { Resultats } from './types.js';

/**
 * Point d'entrée du moteur de calcul.
 *
 * Prend un dossier normalisé et produit l'intégralité des états financiers :
 * amortissements, tableaux d'emprunt, compte de résultat, soldes intermédiaires de
 * gestion, capacité d'autofinancement, ratios, seuil de rentabilité, besoin en fonds
 * de roulement, plan de financement, trésorerie mensuelle, TVA, bilans et contrôles
 * de cohérence.
 *
 * La fonction est pure et déterministe : elle ne lit aucun état global et ne dépend
 * ni de la date du jour ni du fuseau horaire, de sorte que l'interface, le serveur
 * et le générateur PDF obtiennent exactement les mêmes chiffres.
 */
export function calculer(_dossier: Dossier): Resultats {
  throw new Error('Le moteur de calcul n’est pas encore implémenté.');
}

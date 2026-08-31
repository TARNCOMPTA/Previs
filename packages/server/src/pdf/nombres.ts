import {
  formaterMontant,
  formaterMontantOuVide,
  formaterPourcentage,
} from '@previs/core';

/**
 * L'écriture des nombres dans le document imprimé.
 *
 * Un seul point délicat, mais il touche chaque montant du dossier : le séparateur de
 * milliers de Previs est l'espace **fine** insécable, U+202F, et aucune des six polices
 * incorporées ne la possède. Chromium ne montre pas de carré blanc — il retombe
 * silencieusement sur une police du système — mais cette espace de secours n'a pas
 * l'avance de la chasse fixe : dans une colonne de montants, les unités cessent d'être
 * alignées les unes sous les autres.
 *
 * Le document remplace donc U+202F par l'espace insécable **ordinaire**, U+00A0, dont
 * l'avance mesurée dans IBM Plex Mono vaut 600 millièmes de cadratin — exactement celle
 * d'un chiffre. La tabulation reste parfaite, et en prose l'espace vaut 0,26 cadratin
 * dans Hanken Grotesk, ce qui est déjà une espace étroite.
 *
 * Le remplacement n'a lieu qu'ici. Le moteur et l'interface gardent l'espace fine, qui
 * est la forme typographique juste à l'écran.
 */

const ESPACE_FINE = ' ';
const ESPACE_INSECABLE = ' ';

/** Substitue l'espace fine, absente des polices, par l'espace insécable ordinaire. */
export function pourImpression(texte: string): string {
  return texte.split(ESPACE_FINE).join(ESPACE_INSECABLE);
}

/** Montant en euros, sans unité. Une valeur nulle rend un tiret. */
export function mont(valeur: number, decimales = 0): string {
  return pourImpression(formaterMontantOuVide(valeur, decimales));
}

/** Montant en euros, zéro compris — pour un total qui doit s'écrire même à zéro. */
export function montExact(valeur: number, decimales = 0): string {
  return pourImpression(formaterMontant(valeur, decimales));
}

/** Montant suivi de son unité, pour un chiffre hors tableau. */
export function eur(valeur: number, decimales = 0): string {
  return `${montExact(valeur, decimales)}${ESPACE_INSECABLE}€`;
}

/** Pourcentage. Une valeur non finie rend un tiret plutôt qu'un « NaN ». */
export function pct(valeur: number, decimales = 1): string {
  if (!Number.isFinite(valeur)) return '—';
  return pourImpression(formaterPourcentage(valeur, decimales));
}

/**
 * Nombre de jours, écrit en entier.
 *
 * La maquette écrit « 220 jours » à un endroit et « 220 j » à un autre pour la même
 * donnée : le document n'emploie que la forme longue.
 */
export function jours(valeur: number): string {
  if (!Number.isFinite(valeur)) return '—';
  const arrondi = Math.round(valeur);
  return `${montExact(arrondi)}${ESPACE_INSECABLE}${Math.abs(arrondi) === 1 ? 'jour' : 'jours'}`;
}

/** Un ratio sans unité, tel que « 2,4 ». */
export function nombre(valeur: number, decimales = 1): string {
  if (!Number.isFinite(valeur)) return '—';
  return pourImpression(formaterMontant(valeur, decimales));
}

/**
 * La plus longue des chaînes réellement imprimées dans un tableau.
 *
 * C'est cette mesure, et non un pire cas supposé, qui décide de la largeur des colonnes :
 * un tableau de trésorerie où le plus gros montant tient en cinq signes se met en page
 * là où un tableau à sept chiffres ne tiendrait pas.
 */
export function largeurMaximale(valeurs: readonly string[]): number {
  return valeurs.reduce((max, v) => Math.max(max, v.length), 0);
}

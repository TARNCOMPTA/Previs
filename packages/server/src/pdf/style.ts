import { REGLES_POLICES } from './polices.js';

/**
 * Feuille de style d'impression du dossier prévisionnel.
 *
 * La charte vient de la maquette du cabinet : pourpre et or, Spectral en titrage,
 * Hanken Grotesk en texte, IBM Plex Mono pour les chiffres. Les polices sont
 * incorporées en base64 — Chromium imprime sans accès réseau.
 *
 * Deux régimes de page, et il faut comprendre pourquoi il y en a deux :
 *
 * - **feuille** — page nommée sans marge, aplat jusqu'aux quatre bords. Réservée à la
 *   couverture et à la page de coordonnées, dont le contenu est borné par construction.
 * - **flux** — page à marges, paginée par Chromium, en-têtes de tableau répétés, lignes
 *   insécables. Tout le reste du document.
 *
 * La maquette, elle, donne à chaque page une hauteur fixe de 297 mm et un
 * `overflow: hidden`. Ce modèle n'est pas porté : un dossier réel peut compter quarante
 * postes de charges, une annexe de trésorerie de cent trente-deux mois, une introduction
 * de vingt mille signes. Une hauteur fixe y ferait disparaître des lignes de chiffres
 * sans le dire — un chiffre supprimé en silence est aussi faux qu'un chiffre inventé.
 *
 * Le pied de page n'est pas dans cette feuille : en média paginé, un élément en position
 * fixe se répète bien sur chaque page mais son décalage par le bas n'est pas résolu contre
 * la hauteur de page. Il est confié au gabarit natif de Chromium, seul à savoir compter les
 * pages et à être placé de façon fiable dans la marge basse. En contrepartie il est dessiné
 * sur toutes les pages, marge nulle comprise : voir « --bande-pied » ci-dessous.
 */
export const STYLE = `
${REGLES_POLICES}

@page { size: A4 portrait; margin: 20mm 18mm 16mm 18mm; }

/*
 * La couverture et la page de coordonnées sont des pages nommées sans marge : c'est le
 * seul moyen, en média paginé, d'obtenir un aplat de couleur jusqu'aux bords de la
 * feuille, le contenu débordant de la zone de page étant écrêté.
 */
@page pleine { size: A4 portrait; margin: 0; }

/*
 * Les deux pages sans marge s'arrêtent néanmoins 16 mm avant le bas de la feuille.
 *
 * Le pied de page est confié au gabarit natif de Chromium — seul à savoir compter les
 * pages — et celui-ci ignore les marges de la page nommée : il est dessiné sur les 26 pages,
 * en dernier, donc par-dessus l'aplat. Vérifié au rendu : sur une couverture de 297 mm, son
 * filet traverse le bloc « établi par » et son texte gris se superpose au téléphone du
 * cabinet. Réserver la hauteur de la marge basse est le seul moyen de lui rendre un fond
 * propre, et il n'y a rien à y perdre : la couverture y gagne la raison sociale, le cabinet
 * et sa pagination, comme les vingt-quatre autres pages.
 */
:root { --bande-pied: 16mm; }

:root {
  /* Pourpre — la couleur de marque. Le 700 est la teinte principale. */
  --pourpre-50: #f7f3fb;
  --pourpre-100: #efe5f6;
  --pourpre-200: #ddc8ec;
  --pourpre-300: #c4a1dd;
  --pourpre-400: #a673c9;
  --pourpre-500: #8a4cb3;
  --pourpre-600: #723a98;
  --pourpre-700: #5d2e7c;
  --pourpre-800: #4a2563;
  --pourpre-900: #371a49;
  --pourpre-950: #241030;

  /* Neutres — teintés de pourpre, jamais un gris pur. */
  --ink-50: #f8f6fb;
  --ink-100: #efecf3;
  --ink-200: #ddd8e3;
  --ink-300: #b8b1c1;
  --ink-400: #8c8497;
  --ink-500: #6b6276;
  --ink-600: #534a5f;
  --ink-700: #3a3343;
  --ink-800: #2a2533;
  --ink-900: #1c1822;

  /* Or — l'accent de la couverture et du dernier poste d'une répartition. */
  --or-100: #f3e8cf;
  --or-300: #d9bd7e;
  --or-500: #b8923f;
  --or-700: #8f6d27;

  /* Sens, et non simple couleur : ces deux teintes ne s'emploient que pour dire
     « favorable » ou « défavorable », jamais pour décorer. */
  --positif: #2f7a5a;
  --positif-doux: #e3f0ea;
  --negatif: #b23a48;
  --negatif-doux: #f6e4e6;

  /* Rôles */
  --marque: var(--pourpre-700);
  --texte: var(--ink-700);
  --texte-fort: var(--ink-900);
  --texte-doux: var(--ink-500);
  --texte-tres-doux: var(--ink-400);
  --trait: var(--ink-200);
  --trait-doux: var(--ink-100);
  --fond-doux: var(--ink-50);

  --famille-titre: 'Spectral', Georgia, 'Times New Roman', serif;
  --famille-texte: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
  --famille-chiffres: 'IBM Plex Mono', ui-monospace, 'Courier New', monospace;

  --rayon: 4mm;
  --rayon-petit: 2mm;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--famille-texte);
  font-size: 9.6pt;
  line-height: 1.5;
  color: var(--texte);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ─── Titrage ──────────────────────────────────────────────────────────────── */

/*
 * Le surtitre nomme la section et porte son numéro ; le titre est en Spectral, corps
 * généreux et graisse normale — c'est la respiration du document, pas son emphase.
 */
.surtitre {
  font-size: 7.4pt;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--marque);
  margin: 0 0 3mm;
  page-break-after: avoid;
}
h2.titre-section {
  font-family: var(--famille-titre);
  font-weight: 400;
  font-size: 19pt;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--texte-fort);
  margin: 0 0 3mm;
  page-break-after: avoid;
}
p.chapeau {
  font-size: 10pt;
  color: var(--texte-doux);
  margin: 0 0 5mm;
  text-align: left;
  page-break-after: avoid;
}
h3.sous-titre {
  font-size: 8.4pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--marque);
  margin: 6mm 0 2.5mm;
  page-break-after: avoid;
}
p { margin: 0 0 3mm; text-align: justify; }
p.intro { text-indent: 6mm; }

/* ─── Couverture ───────────────────────────────────────────────────────────── */

.couverture {
  page: pleine;
  position: relative;
  z-index: 10;
  height: calc(297mm - var(--bande-pied));
  background: var(--pourpre-950);
  color: #fff;
  display: flex;
  flex-direction: column;
  page-break-after: always;
  overflow: hidden;
}
/* Le filet dégradé du haut de page, signature de la charte. */
.couverture .filet {
  height: 6mm;
  flex: 0 0 6mm;
  background: linear-gradient(90deg, var(--pourpre-500) 0%, var(--pourpre-400) 38%, var(--or-500) 100%);
}
.couverture .corps {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 18mm 20mm 0 20mm;
}
.couverture .entete { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; }
/* Le mot-composé doré n'est le titre du cabinet que faute de logo déposé. */
.couverture .mot-compose {
  font-family: var(--famille-titre);
  font-size: 13pt;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--or-300);
}
.couverture .mention-droite {
  text-align: right;
  font-size: 7.6pt;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--pourpre-300);
  line-height: 1.9;
}
.couverture .client { margin-top: auto; padding-bottom: 14mm; }
.couverture .etiquette {
  font-size: 7.4pt;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--or-300);
  margin-bottom: 4mm;
}
.couverture h1 {
  font-family: var(--famille-titre);
  font-weight: 400;
  font-size: 40pt;
  line-height: 1.03;
  letter-spacing: -0.015em;
  margin: 0 0 6mm;
}
.couverture h1.long { font-size: 30pt; }
.couverture h1.tres-long { font-size: 23pt; }
.couverture .identite { display: flex; gap: 10mm; font-size: 9.4pt; color: #fff; opacity: 0.9; }
.couverture .identite > div + div { border-left: 0.4pt solid var(--pourpre-700); padding-left: 10mm; }
.couverture .identite p { margin: 0 0 1mm; text-align: left; }
.couverture .pied {
  background: var(--pourpre-900);
  padding: 10mm 20mm;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12mm;
}
.couverture .pied .etiquette { margin-bottom: 3mm; }
.couverture .pied p { margin: 0 0 1mm; text-align: left; font-size: 9pt; opacity: 0.9; }
.couverture .periode {
  font-family: var(--famille-chiffres);
  font-size: 9pt;
  color: var(--or-300);
  white-space: nowrap;
}

/* Un logo est dessiné pour un fond blanc : sur le pourpre de la charte, il est posé sur
   un cartouche clair plutôt que détouré au jugé. */
.cartouche-logo {
  display: inline-block;
  background: #fff;
  border-radius: var(--rayon-petit);
  padding: 3mm 4mm;
  line-height: 0;
}
.cartouche-logo img { display: block; }
.couverture .logo-cabinet img { max-height: 18mm; max-width: 62mm; }
.couverture .identite .cartouche-logo { margin-bottom: 3mm; padding: 2mm 3mm; }
.couverture .identite .cartouche-logo img { max-height: 14mm; max-width: 45mm; }

/* ─── Page de coordonnées ──────────────────────────────────────────────────── */

.coordonnees {
  page: pleine;
  position: relative;
  z-index: 10;
  height: calc(297mm - var(--bande-pied));
  background: var(--pourpre-950);
  color: #fff;
  padding: 62mm 24mm;
  page-break-before: always;
  text-align: center;
  overflow: hidden;
}
.coordonnees .nom {
  font-family: var(--famille-titre);
  font-size: 22pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--or-300);
  margin-bottom: 8mm;
}
.coordonnees p { margin: 0 0 2mm; font-size: 10.5pt; text-align: center; }
.coordonnees .cartouche-logo { margin-bottom: 10mm; }
.coordonnees .cartouche-logo img { max-height: 24mm; max-width: 80mm; }
.coordonnees .qualite { font-size: 9.6pt; color: var(--pourpre-300); margin-bottom: 6mm; }
.coordonnees .legales { margin-top: 10mm; font-size: 8.4pt; color: var(--pourpre-300); line-height: 1.8; }
.coordonnees .mention { margin-top: 12mm; font-size: 8pt; color: var(--pourpre-300); line-height: 1.65; text-align: left; }

/* ─── Sections ─────────────────────────────────────────────────────────────── */

section { page-break-inside: auto; }
section.nouvelle-page { page-break-before: always; }

/* ─── Cartes ───────────────────────────────────────────────────────────────── */

.carte {
  border: 0.4pt solid var(--trait);
  border-radius: var(--rayon);
  padding: 5mm 6mm;
  margin-bottom: 4mm;
  page-break-inside: avoid;
}
.carte.teintee { background: var(--fond-doux); }
.carte.marque { background: var(--pourpre-700); border-color: var(--pourpre-700); color: #fff; }
.carte > .intitule {
  font-size: 7.4pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--texte-tres-doux);
  margin-bottom: 3mm;
}
.carte.marque > .intitule { color: var(--pourpre-200); }

/* Une grille de deux colonnes se replie en une seule au-delà de trois exercices :
   un tableau de montants n'a plus la place dans une demi-page. */
.grille { display: flex; gap: 4mm; margin-bottom: 4mm; align-items: stretch; }
.grille > * { margin-bottom: 0; }
.grille.large-etroit > :first-child { flex: 1.35; }
.grille.large-etroit > :last-child { flex: 1; }
.grille.egale > * { flex: 1; }
.grille.repliee { display: block; }
.grille.repliee > * { margin-bottom: 4mm; }

/* ─── Cartouches de chiffre clé ────────────────────────────────────────────── */

.cartouches { display: flex; gap: 4mm; margin-bottom: 5mm; page-break-inside: avoid; }
.cartouche {
  flex: 1;
  border: 0.4pt solid var(--trait);
  border-radius: var(--rayon);
  padding: 4mm 5mm;
}
.cartouche.saillant { background: var(--pourpre-700); border-color: var(--pourpre-700); color: #fff; }
.cartouche .intitule {
  font-size: 7pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--texte-tres-doux);
  margin-bottom: 2mm;
  line-height: 1.4;
}
.cartouche.saillant .intitule { color: var(--pourpre-200); }
.cartouche .valeur {
  font-family: var(--famille-chiffres);
  font-size: 17pt;
  font-weight: 400;
  letter-spacing: -0.02em;
  color: var(--texte-fort);
  font-variant-numeric: tabular-nums;
}
.cartouche.saillant .valeur { color: #fff; }
.cartouche .precision { font-size: 8pt; color: var(--texte-doux); margin-top: 1.5mm; }
.cartouche.saillant .precision { color: var(--pourpre-200); }
.cartouche .precision.favorable { color: var(--positif); }
.cartouche .precision.defavorable { color: var(--negatif); }

/* ─── Liste d'indicateurs ──────────────────────────────────────────────────── */

.indicateurs { margin: 0; }
.indicateurs .rangee {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4mm;
  padding: 2.2mm 0;
  border-bottom: 0.4pt solid var(--trait-doux);
}
.indicateurs .rangee:last-child { border-bottom: 0; }
.indicateurs .libelle { font-size: 9pt; color: var(--texte); }
.indicateurs .valeur {
  font-family: var(--famille-chiffres);
  font-size: 9.4pt;
  color: var(--texte-fort);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.indicateurs .valeur.favorable { color: var(--positif); }
.indicateurs .valeur.defavorable { color: var(--negatif); }

/* ─── Jauges ───────────────────────────────────────────────────────────────── */

.jauges { margin: 0; }
.jauges .rangee { margin-bottom: 3mm; }
.jauges .rangee:last-child { margin-bottom: 0; }
.jauges .tete {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 3mm;
  margin-bottom: 1.2mm;
}
.jauges .libelle { font-size: 8.6pt; color: var(--texte); }
.jauges .part {
  font-family: var(--famille-chiffres);
  font-size: 8.4pt;
  color: var(--texte-doux);
  white-space: nowrap;
}
.jauges .piste { height: 1.9mm; background: var(--ink-100); border-radius: 1mm; overflow: hidden; }
.jauges .remplissage { height: 100%; border-radius: 1mm; }

/* ─── Tableaux ─────────────────────────────────────────────────────────────── */

/*
 * « table-layout: fixed » et « white-space: nowrap » rendent le calcul de largeur des
 * colonnes exact : la répartition décidée en amont n'est plus une espérance.
 */
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 4mm;
  font-size: 8.8pt;
  font-variant-numeric: tabular-nums;
}
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th {
  background: var(--pourpre-950);
  color: #fff;
  font-weight: 600;
  font-size: 7.4pt;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: right;
  padding: 2.4mm 2.6mm;
  /*
   * Un en-tête se replie sur deux lignes plutôt que de déborder.
   *
   * La largeur d'une colonne est calculée sur les montants qu'elle porte, en chasse fixe ;
   * l'en-tête, lui, est en capitales espacées, et « CAPITAL RESTANT DÛ » ou « % DU CA 2028 »
   * y sont plus larges que les chiffres qu'ils coiffent. En « nowrap » ils sortaient de la
   * justification — vérifié au rendu, le « Û » et le « 8 » tombaient hors de la feuille.
   * Une coupure se fait aux espaces : rien n'est perdu, l'en-tête gagne une ligne.
   */
  white-space: normal;
}
th:first-child { text-align: left; }
/*
 * Pas d'« overflow: hidden » ni de « text-overflow: ellipsis » ici, et c'est délibéré :
 * « 92 0… » se lit comme un nombre complet qui serait petit, alors que c'est 92 000
 * amputé. Un chiffre tronqué en silence est aussi faux qu'un chiffre inventé. La largeur
 * des colonnes est calculée sur la plus longue chaîne réellement imprimée (composants.ts,
 * « repartirColonnes ») ; si elle se révélait insuffisante, un montant qui dépasse se voit,
 * et c'est ce qu'on veut.
 */
td {
  padding: 1.9mm 2.6mm;
  text-align: right;
  border-bottom: 0.4pt solid var(--trait-doux);
  white-space: nowrap;
}
td:first-child { text-align: left; white-space: normal; }
/* Les cellules de montant, en chasse fixe : c'est ce qui aligne les unités. */
td.nombre, .nombres { font-family: var(--famille-chiffres); }
td.part { font-family: var(--famille-chiffres); color: var(--texte-tres-doux); font-size: 8pt; }

/* Cinq degrés de ligne, du plus discret au plus fort. */
tr.detail td:first-child { padding-left: 5mm; color: var(--texte-doux); }
tr.groupe td {
  font-size: 7.4pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--marque);
  padding-top: 4mm;
  padding-bottom: 1.6mm;
  border-bottom: 0;
  font-weight: 600;
}
tr.sous-total { background: var(--pourpre-50); }
tr.sous-total td { font-weight: 600; }
tr.sous-total td.nombre { font-weight: 500; }
tr.total { background: var(--pourpre-100); }
tr.total td { font-weight: 600; border-top: 0.5pt solid var(--pourpre-300); border-bottom: 0.5pt solid var(--pourpre-300); }
tr.total td.nombre { font-weight: 500; }
tr.resultat { background: var(--pourpre-700); }
tr.resultat td {
  color: #fff;
  font-weight: 600;
  border-bottom: 0;
  font-size: 8.6pt;
  letter-spacing: 0.04em;
}
tr.resultat td.nombre { font-weight: 600; }
tr.resultat td.part { color: var(--pourpre-200); }
td.negatif, .negatif { color: var(--negatif); }
tr.resultat td.negatif { color: var(--or-300); }

/* Deux densités de repli, quand le nombre de colonnes serre. */
table.compacte { font-size: 8pt; }
table.compacte th { padding: 1.8mm 2mm; }
table.compacte td { padding: 1.4mm 2mm; }
table.dense { font-size: 7.2pt; }
table.dense th { padding: 1.3mm 1.4mm; letter-spacing: 0.06em; }
table.dense td { padding: 1mm 1.4mm; }

/* Le titre d'un bloc de colonnes : il nomme ce que le bloc contient, jamais « suite ». */
.intertitre-bloc {
  font-size: 7.8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--texte-doux);
  margin: 4mm 0 1.5mm;
  page-break-after: avoid;
}
/*
 * La note ne part pas seule à la page suivante : elle explique le tableau qu'elle suit,
 * et détachée elle n'explique plus rien.
 */
.note-tableau {
  font-size: 7.8pt;
  color: var(--texte-tres-doux);
  margin: -2mm 0 4mm;
  text-align: left;
  page-break-before: avoid;
  page-break-inside: avoid;
}

/* ─── Encadrés ─────────────────────────────────────────────────────────────── */

.encadre {
  border-left: 0.9pt solid var(--pourpre-300);
  background: var(--pourpre-50);
  border-radius: 0 var(--rayon-petit) var(--rayon-petit) 0;
  padding: 3.5mm 4.5mm;
  margin-bottom: 4mm;
  page-break-inside: avoid;
}
.encadre.alerte { border-left-color: var(--negatif); background: var(--negatif-doux); }
.encadre.favorable { border-left-color: var(--positif); background: var(--positif-doux); }
.encadre h3 { margin: 0 0 2mm; color: var(--marque); font-size: 9.4pt; }
.encadre p:last-child { margin-bottom: 0; }
.encadre ul { margin: 0; padding-left: 5mm; }
.encadre li { margin-bottom: 1.5mm; }

.graphique { margin: 2mm 0 4mm; page-break-inside: avoid; }

/* Ce qui suit la ligne de résultat lui reste attaché : l'impôt sur le revenu d'un
 * exploitant, seul en tête de page, se lirait comme un poste sans rapport. */
tr.resultat { page-break-after: avoid; }

/* ─── Sommaire ─────────────────────────────────────────────────────────────── */

ol.sommaire { list-style: none; padding: 0; margin: 0; font-size: 9.6pt; }
ol.sommaire li {
  display: flex;
  align-items: baseline;
  gap: 3mm;
  padding: 2mm 0;
  border-bottom: 0.4pt solid var(--trait-doux);
}
ol.sommaire .numero {
  font-family: var(--famille-chiffres);
  font-size: 8.4pt;
  color: var(--marque);
  min-width: 7mm;
}
`;

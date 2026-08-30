/**
 * Feuille de style d'impression du dossier prévisionnel, à la charte TARN COMPTA.
 *
 * Les bandeaux d'en-tête et de pied ne sont pas dans cette feuille : en média paginé,
 * un élément en position fixe se répète bien sur chaque page mais son décalage par
 * le bas n'est pas résolu contre la hauteur de page. Ils sont donc confiés aux
 * gabarits natifs de Chromium, seuls à être placés de façon fiable dans les marges —
 * et absents, par construction, des pages nommées sans marge.
 */
export const STYLE = `
@page { size: A4 portrait; margin: 24mm 14mm 18mm 14mm; }

/*
 * La page de garde et la page de coordonnées sont des pages nommées sans marge :
 * c'est le seul moyen, en média paginé, d'obtenir un aplat de couleur jusqu'aux
 * bords de la feuille, le contenu débordant de la zone de page étant écrêté.
 */
@page pleine { size: A4 portrait; margin: 0; }

:root {
  --bleu: #1E3FCC;
  --bleu-fonce: #16309B;
  --turquoise: #5BC5C5;
  --bleu-clair: #E8F0FE;
  --texte: #1F2430;
  --gris: #5A6272;
  --trait: #C9D2E3;
  --rouge: #C0392B;
  --ambre: #B9770E;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Helvetica, "Liberation Sans", Arial, sans-serif;
  font-size: 9.3pt;
  line-height: 1.42;
  color: var(--texte);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ─── Page de garde ────────────────────────────────────────────────────────── */

.couverture {
  page: pleine;
  position: relative;
  z-index: 10;
  height: 297mm;
  background: var(--bleu);
  color: #fff;
  padding: 38mm 22mm 24mm;
  display: flex;
  flex-direction: column;
  page-break-after: always;
}
.couverture h1 {
  font-size: 30pt;
  letter-spacing: 1.5px;
  margin: 0 0 4mm;
  font-weight: bold;
}
.couverture .sous-titre { font-size: 13pt; opacity: 0.92; margin-bottom: 3mm; }
.couverture .activite { font-size: 10.5pt; opacity: 0.8; }
.couverture .fleche { margin: 14mm 0; }
.couverture .blocs {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  gap: 14mm;
  font-size: 9.5pt;
}
.couverture .blocs h2 {
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  opacity: 0.72;
  margin: 0 0 2.5mm;
  font-weight: normal;
}
.couverture .blocs p { margin: 0 0 1mm; text-align: left; }
.couverture .blocs .nom { font-size: 12pt; font-weight: bold; margin-bottom: 2mm; }

/* Un logo est dessiné pour un fond blanc : sur le bleu de la charte, il est posé
   sur un cartouche clair plutôt que détouré au jugé. */
.cartouche-logo {
  display: inline-block;
  background: #fff;
  border-radius: 2mm;
  padding: 3mm 4mm;
  line-height: 0;
}
.cartouche-logo img { display: block; }
 /* La couverture est une colonne flex : sans cela le cartouche s'étirerait
     sur toute la largeur au lieu d'épouser le logo. */
.couverture .logo-cabinet { margin-bottom: 12mm; align-self: flex-start; }
.couverture .logo-cabinet img { max-height: 20mm; max-width: 70mm; }
.couverture .blocs .cartouche-logo { margin-bottom: 3mm; padding: 2mm 3mm; }
.couverture .blocs .cartouche-logo img { max-height: 14mm; max-width: 45mm; }

/* ─── Dernière page ────────────────────────────────────────────────────────── */

.coordonnees {
  page: pleine;
  position: relative;
  z-index: 10;
  height: 297mm;
  background: var(--bleu);
  color: #fff;
  padding: 80mm 22mm;
  page-break-before: always;
  text-align: center;
}
.coordonnees .nom { font-size: 24pt; font-weight: bold; letter-spacing: 2px; margin-bottom: 8mm; }
.coordonnees p { margin: 0 0 2mm; font-size: 11pt; text-align: center; }
.coordonnees .cartouche-logo { margin-bottom: 10mm; }
.coordonnees .cartouche-logo img { max-height: 24mm; max-width: 80mm; }
.coordonnees .qualite { font-size: 10pt; opacity: 0.82; margin-bottom: 6mm; }
.coordonnees .legales { margin-top: 10mm; font-size: 9pt; opacity: 0.78; line-height: 1.7; }
.coordonnees .mention { margin-top: 12mm; font-size: 8.5pt; opacity: 0.75; line-height: 1.6; }

/* ─── Sections ─────────────────────────────────────────────────────────────── */

section { page-break-inside: auto; }
section.nouvelle-page { page-break-before: always; }

h2.titre-section {
  color: var(--bleu);
  font-size: 14pt;
  margin: 0 0 4mm;
  padding-bottom: 1.5mm;
  border-bottom: 1.4pt solid var(--turquoise);
  page-break-after: avoid;
}
h3.sous-titre {
  color: var(--bleu);
  font-size: 10.5pt;
  margin: 6mm 0 2.5mm;
  page-break-after: avoid;
}
p { margin: 0 0 3mm; text-align: justify; }
p.intro { text-indent: 6mm; }

/* ─── Tableaux ─────────────────────────────────────────────────────────────── */

table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 8.8pt; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th {
  background: var(--turquoise);
  color: #fff;
  font-weight: bold;
  text-align: right;
  padding: 1.8mm 2mm;
  font-size: 8.4pt;
}
th:first-child { text-align: left; }
td { padding: 1.5mm 2mm; text-align: right; border-bottom: 0.4pt solid #EDF1F8; }
td:first-child { text-align: left; }
tbody tr:nth-child(even) { background: var(--bleu-clair); }
tr.total { background: var(--bleu-clair) !important; font-weight: bold; }
tr.total td { border-top: 0.8pt solid var(--turquoise); border-bottom: 0.8pt solid var(--turquoise); }
tr.sous-total { background: #F2F6FE !important; font-weight: bold; }
tr.groupe td { background: #fff; font-weight: bold; color: var(--bleu); padding-top: 3mm; }
td.detail { font-style: italic; color: var(--gris); padding-left: 5mm; }
td.negatif, .negatif { color: var(--rouge); }
.nombres { font-variant-numeric: tabular-nums; }
table { font-variant-numeric: tabular-nums; }
table.compacte { font-size: 7.4pt; }
table.compacte th, table.compacte td { padding: 1mm 1.2mm; }

/* ─── Encadrés ─────────────────────────────────────────────────────────────── */

.encadre {
  border-left: 2.5pt solid var(--turquoise);
  background: var(--bleu-clair);
  padding: 3mm 4mm;
  margin-bottom: 4mm;
  page-break-inside: avoid;
}
.encadre.alerte { border-left-color: var(--rouge); background: #FDF0EE; }
.encadre h3 { margin-top: 0; color: var(--bleu); font-size: 10pt; }
.encadre ul { margin: 0; padding-left: 5mm; }
.encadre li { margin-bottom: 1.5mm; }

.indicateurs { display: flex; gap: 4mm; margin-bottom: 5mm; page-break-inside: avoid; }
.indicateur {
  flex: 1;
  border: 0.6pt solid var(--trait);
  border-top: 2.5pt solid var(--turquoise);
  padding: 3mm;
  text-align: center;
}
.indicateur .valeur { font-size: 15pt; font-weight: bold; color: var(--bleu); font-variant-numeric: tabular-nums; }
.indicateur .libelle { font-size: 8pt; color: var(--gris); margin-top: 1mm; }

.graphique { margin: 3mm 0 5mm; page-break-inside: avoid; }

ol.sommaire { list-style: none; padding: 0; counter-reset: item; font-size: 10pt; }
ol.sommaire li {
  counter-increment: item;
  padding: 1.6mm 0;
  border-bottom: 0.4pt dotted var(--trait);
}
ol.sommaire li::before {
  content: counter(item) ". ";
  color: var(--bleu);
  font-weight: bold;
  margin-right: 2mm;
}
`;

#!/usr/bin/env node
/**
 * Engendre « polices.ts » : les fichiers woff2 de ce répertoire, en base64.
 *
 * Pourquoi un module engendré plutôt qu'une lecture de fichier à l'exécution : le serveur
 * est empaqueté par tsup en un seul « dist/index.js ». Une lecture relative à
 * « import.meta.url » viserait alors dist/, où les woff2 ne sont pas, et il faudrait une
 * étape de copie que l'installateur devrait reproduire sur le VPS. Un module engendré
 * s'empaquette avec le reste et ne peut pas se désynchroniser du binaire livré.
 *
 * À relancer après tout remplacement de police :
 *   node packages/server/src/pdf/polices/engendrer.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Ce que chaque fichier devient dans la feuille de style.
 *
 * L'ordre compte : il est repris tel quel dans les règles @font-face engendrées.
 *
 * « pied » marque les deux faces reprises dans le gabarit de pied de page. Chromium rend
 * ce gabarit dans un document isolé, qui n'hérite pas de la feuille de style du dossier :
 * sans ses propres @font-face, le pied serait la seule ligne du document composée dans la
 * police du système. Il n'en reprend que deux — le texte et les chiffres moyens — plutôt
 * que les sept, le gabarit étant réinterprété à chaque page.
 *
 * **Aucune face n'est variable, et c'est délibéré.** Chromium ne sait pas incorporer une
 * police variable dans un PDF : il en dessine chaque glyphe en Type3, une procédure de
 * tracé par caractère. Le dossier pesait ainsi 337 Ko au lieu de 172, avec quinze polices
 * Type3 là où il en faut quatre. Les trois faces de Hanken Grotesk sont donc des
 * instances statiques du fichier variable d'origine, découpées par
 * « fontTools.varLib.instancer » : mêmes contours, mêmes métriques, mêmes 268 glyphes.
 * Les graisses sont celles que le document demande — 400 pour le texte, 600 pour les
 * en-têtes, 700 pour « strong ». Ne jamais remettre un fichier variable ici.
 */
const FACES = [
  { fichier: 'HankenGrotesk-400-latin.woff2', nom: 'texte', famille: 'Hanken Grotesk', graisse: '400', pied: true },
  { fichier: 'HankenGrotesk-600-latin.woff2', nom: 'texteGras', famille: 'Hanken Grotesk', graisse: '600' },
  { fichier: 'HankenGrotesk-700-latin.woff2', nom: 'texteTresGras', famille: 'Hanken Grotesk', graisse: '700' },
  { fichier: 'Spectral-400-latin.woff2', nom: 'titreNormal', famille: 'Spectral', graisse: '400' },
  { fichier: 'Spectral-600-latin.woff2', nom: 'titreGras', famille: 'Spectral', graisse: '600' },
  { fichier: 'IBMPlexMono-400-latin.woff2', nom: 'chiffresNormal', famille: 'IBM Plex Mono', graisse: '400' },
  { fichier: 'IBMPlexMono-500-latin.woff2', nom: 'chiffresMoyen', famille: 'IBM Plex Mono', graisse: '500', pied: true },
  { fichier: 'IBMPlexMono-600-latin.woff2', nom: 'chiffresGras', famille: 'IBM Plex Mono', graisse: '600' },
];

const presents = new Set(readdirSync(ici).filter((f) => f.endsWith('.woff2')));
const manquants = FACES.filter((f) => !presents.has(f.fichier)).map((f) => f.fichier);
if (manquants.length) {
  console.error(`Fichiers absents : ${manquants.join(', ')}`);
  process.exit(1);
}
for (const f of presents) {
  if (!FACES.some((face) => face.fichier === f)) {
    console.error(`« ${f} » n'est déclaré dans aucune face : l'ajouter à FACES ou le retirer.`);
    process.exit(1);
  }
}

const lignes = [];
let total = 0;
for (const face of FACES) {
  const octets = readFileSync(join(ici, face.fichier));
  total += octets.length;
  lignes.push(
    `  /** ${face.famille} ${face.graisse} — ${face.fichier}, ${octets.length} octets. */\n` +
      `  ${face.nom}: '${octets.toString('base64')}',`,
  );
}

const face = (f, retrait) =>
  `${retrait}@font-face {\n` +
  `${retrait}  font-family: '${f.famille}';\n` +
  `${retrait}  font-weight: ${f.graisse};\n` +
  `${retrait}  font-style: normal;\n` +
  `${retrait}  font-display: block;\n` +
  `${retrait}  src: url(data:font/woff2;base64,\${POLICES.${f.nom}}) format('woff2');\n` +
  `${retrait}}`;

const regles = FACES.map((f) => face(f, '  ')).join('\n');
const reglesPied = FACES.filter((f) => f.pied).map((f) => face(f, '')).join('\n');
const poidsPied = FACES.filter((f) => f.pied).reduce(
  (somme, f) => somme + readFileSync(join(ici, f.fichier)).length,
  0,
);

const contenu = `// ⚠ Fichier engendré par polices/engendrer.mjs — ne pas modifier à la main.
//
// Les polices du dossier PDF, en base64. Chromium imprime sans accès réseau : une police
// appelée depuis le réseau ne serait jamais chargée, et le document retomberait sur ce que
// le serveur a en magasin. Voir polices/LICENCES.md pour les familles et leurs droits.
//
// Poids total des fichiers : ${(total / 1024).toFixed(0)} Ko, soit ${((total * 4) / 3 / 1024).toFixed(0)} Ko une fois encodés.
// Chromium n'incorpore au PDF que les glyphes réellement employés, et seulement s'il peut
// incorporer la police : une face variable serait dessinée glyphe par glyphe, en Type3.
// Aucune de celles-ci ne l'est.

const POLICES = {
${lignes.join('\n')}
} as const;

/** Règles @font-face à placer en tête de la feuille de style du document. */
export const REGLES_POLICES = \`
${regles}
\`;

/**
 * Les deux seules faces reprises dans le gabarit de pied de page, ${(poidsPied / 1024).toFixed(0)} Ko.
 *
 * Le gabarit natif de Chromium est rendu dans un document isolé qui n'hérite pas de la
 * feuille de style du dossier : sans ces règles, le pied serait la seule ligne du document
 * composée dans la police du système.
 */
export const REGLES_POLICES_PIED = \`
${reglesPied}
\`;
`;

writeFileSync(join(ici, '..', 'polices.ts'), contenu);
console.log(
  `polices.ts engendré : ${FACES.length} faces, ${(total / 1024).toFixed(0)} Ko de woff2, ` +
    `${(contenu.length / 1024).toFixed(0)} Ko de module.`,
);

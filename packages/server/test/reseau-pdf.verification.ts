/**
 * Vérification à la main du blocage réseau de l'impression. Chromium requis.
 *
 *     npx tsx packages/server/test/reseau-pdf.verification.ts
 *
 * Elle n'est pas dans la suite d'essais : le nom ne porte pas « .test », et rien de la
 * suite ne lance Chromium — c'est ce qui la garde à onze secondes. Mais la propriété
 * éprouvée ici ne s'observe pas autrement : « --disable-background-networking » ne coupe
 * que les services d'arrière-plan du navigateur, jamais les requêtes de la page, et cette
 * différence-là ne se déduit d'aucun code. Elle se constate.
 *
 * Le témoin est un serveur HTTP local. Le document imprimé reçoit une balise « img » et un
 * « link » qui pointent vers lui — ce que produirait un trou d'échappement dans un gabarit.
 * S'il est touché, une donnée de dossier client peut sortir du VPS au moment de l'export.
 *
 * Le contrôle est mené deux fois, avec et sans interception, parce qu'un essai qui ne peut
 * pas être mis en défaut ne prouve rien : la ligne « sans interception » doit montrer le
 * témoin touché, sinon c'est le montage de l'essai qui est faux.
 *
 * Attendu :
 *   sans interception    : serveur témoin touché 2 fois (/style.css, /pixel.png) · polices chargées : 3
 *   avec interception    : serveur témoin touché 0 fois · polices chargées : 3
 *
 * Les trois polices restent chargées dans les deux cas : elles sont incorporées en
 * « data: », que l'interception ne voit pas. Un blocage qui les emporterait rendrait un
 * document aux colonnes de montants vides.
 */
import { createServer } from 'node:http';
import { calculer, modeleDossier } from '@previs/core';
import { chromium } from 'playwright-core';
import { construireHtml } from '../src/pdf/document.js';

const PORT_TEMOIN = 9931;

let touches: string[] = [];
const temoin = createServer((requete, reponse) => {
  touches.push(requete.url ?? '');
  reponse.writeHead(200, { 'content-type': 'image/png' });
  reponse.end(Buffer.from('89504e470d0a1a0a', 'hex'));
});
await new Promise<void>((resoudre) => temoin.listen(PORT_TEMOIN, '127.0.0.1', () => resoudre()));

const dossier = modeleDossier('IS');
const resultats = calculer(dossier);
const htmlPiege = construireHtml(dossier, resultats).replace(
  '<body>',
  `<body><img src="http://127.0.0.1:${PORT_TEMOIN}/pixel.png" alt="">` +
    `<link rel="stylesheet" href="http://127.0.0.1:${PORT_TEMOIN}/style.css">`,
);

const chemin = (process.env.CHROMIUM_PATH ?? '').trim();
const navigateur = await chromium.launch({
  ...(chemin ? { executablePath: chemin } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
});

for (const [nom, avecInterception] of [
  ['sans interception', false],
  ['avec interception', true],
] as const) {
  touches = [];
  const contexte = await navigateur.newContext({ locale: 'fr-FR', javaScriptEnabled: false });
  if (avecInterception) await contexte.route('**/*', (route) => route.abort('blockedbyclient'));
  const page = await contexte.newPage();
  await page.setContent(htmlPiege, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  // Expression transmise en chaîne : le paquet ne compile pas avec la bibliothèque DOM,
  // et ce fragment-ci s'exécute dans la page, pas ici.
  const polices = await page.evaluate<number>(
    "new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)).size",
  );
  await contexte.close();
  console.log(
    `${nom.padEnd(20)} : serveur témoin touché ${touches.length} fois ` +
      `${touches.length ? `(${touches.join(', ')})` : ''} · polices chargées : ${polices}`,
  );
}

await navigateur.close();
temoin.close();

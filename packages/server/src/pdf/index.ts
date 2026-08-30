import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { Dossier, Resultats } from '@previs/core';
import { construireEntete, construireHtml, construirePied } from './document.js';

let navigateur: Browser | null = null;
let ouvertureEnCours: Promise<Browser> | null = null;

/**
 * Ouvre un navigateur unique, réutilisé d'une génération à l'autre.
 *
 * Lancer Chromium coûte environ une seconde : le garder ouvert rend l'export d'un
 * dossier quasi instantané dès la deuxième fois. Les appels concurrents partagent
 * la même promesse d'ouverture, pour ne jamais lancer deux navigateurs.
 */
async function obtenirNavigateur(): Promise<Browser> {
  if (navigateur?.isConnected()) return navigateur;
  if (ouvertureEnCours) return ouvertureEnCours;

  ouvertureEnCours = chromium
    .launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    })
    .then((b) => {
      navigateur = b;
      ouvertureEnCours = null;
      return b;
    })
    .catch((erreur) => {
      ouvertureEnCours = null;
      throw new Error(
        `Chromium n’a pas pu démarrer (${erreur instanceof Error ? erreur.message : erreur}). ` +
          'Vérifier la variable CHROMIUM_PATH et l’installation du paquet chromium.',
      );
    });

  return ouvertureEnCours;
}

/** Ferme le navigateur partagé, à l'arrêt du serveur. */
export async function fermerNavigateur(): Promise<void> {
  const courant = navigateur;
  navigateur = null;
  if (courant?.isConnected()) await courant.close();
}

/**
 * Produit le dossier prévisionnel au format PDF, à la charte TARN COMPTA.
 *
 * La numérotation des pages est confiée au pied de page natif de Chromium, seul
 * moyen de connaître le nombre total de pages ; les bandeaux, eux, sont des éléments
 * en position fixe que Chromium répète sur chaque page.
 */
export async function genererPdf(
  dossier: Dossier,
  resultats: Resultats,
  options: { titre?: string } = {},
): Promise<Uint8Array> {
  const html = construireHtml(dossier, resultats, options);
  const b = await obtenirNavigateur();
  const contexte = await b.newContext({ locale: 'fr-FR' });
  const page = await contexte.newPage();

  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: construireEntete(dossier, resultats),
      footerTemplate: construirePied(),
    });
  } finally {
    await contexte.close();
  }
}

export { construireEntete, construireHtml, construirePied };

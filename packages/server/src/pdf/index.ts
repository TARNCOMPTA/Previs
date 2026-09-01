import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { Dossier, Resultats } from '@previs/core';
import { CABINET_PAR_DEFAUT } from '@previs/core';
import { construireHtml, construirePied, type OptionsDocument } from './document.js';
import { avecDelai, FileImpressions } from './file.js';

let navigateur: Browser | null = null;
let ouvertureEnCours: Promise<Browser> | null = null;

/**
 * Résultat du contrôle de démarrage, lisible par la route d'état.
 *
 * `null` tant que rien n'a été éprouvé — le cas des essais, qui ne lancent pas Chromium.
 */
export const etatSortiePdf: { ok: boolean | null; message: string } = { ok: null, message: '' };

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

  // Sans chemin imposé, c'est Playwright qui choisit son binaire — et il choisit la
  // coquille sans affichage, bâtie pour ça. Un chemin trouvé à la main désigne au
  // contraire le Chrome complet, qui échoue au montage de son gestionnaire de plantage
  // sous une unité systemd cloisonnée. Le chemin explicite reste honoré : un Chromium de
  // distribution est un cas légitime, mais il doit être un choix, pas une devinette.
  const chemin = (process.env.CHROMIUM_PATH ?? '').trim();

  ouvertureEnCours = chromium
    .launch({
      ...(chemin ? { executablePath: chemin } : {}),
      /*
       * Ces drapeaux coupent les services d'ARRIÈRE-PLAN de Chromium — mises à jour de
       * composants, navigation sécurisée, synchronisation. Ils ne coupent PAS les requêtes
       * de la page : « --disable-background-networking » ne s'applique qu'au navigateur
       * lui-même. Le blocage du trafic de la page est fait par interception, dans
       * « genererPdf », et c'est là qu'il faut le chercher.
       */
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        '--metrics-recording-only',
        '--mute-audio',
      ],
    })
    .then((b) => {
      navigateur = b;
      ouvertureEnCours = null;
      return b;
    })
    .catch((erreur) => {
      ouvertureEnCours = null;
      const message = erreur instanceof Error ? erreur.message : String(erreur);

      // Le conseil dépend de ce qui a réellement échoué. L'ancien message renvoyait
      // toujours à CHROMIUM_PATH, y compris quand le binaire avait démarré puis crashé :
      // il envoyait chercher la panne là où elle n'était pas.
      const aDemarre = /<launched>|pid=\d+/.test(message);
      const introuvable = /Executable doesn’t exist|Executable doesn't exist|ENOENT/.test(message);

      let conseil: string;
      if (introuvable) {
        conseil = chemin
          ? `Le binaire désigné par CHROMIUM_PATH est absent : ${chemin}`
          : 'Aucun navigateur installé pour Playwright. Vérifier PLAYWRIGHT_BROWSERS_PATH, ' +
            'ou installer : node node_modules/playwright-core/cli.js install chromium';
      } else if (aDemarre) {
        conseil =
          `Le binaire a démarré puis s’est arrêté : ce n’est ni CHROMIUM_PATH ni le paquet. ` +
          (chemin
            ? `CHROMIUM_PATH impose « ${chemin} » ; laisser cette variable vide fait choisir à ` +
              'Playwright sa coquille sans affichage, qui convient au cloisonnement du service.'
            : 'Vérifier les bibliothèques de rendu et le cloisonnement de l’unité systemd.');
      } else {
        conseil = chemin
          ? `Vérifier le binaire désigné par CHROMIUM_PATH : ${chemin}`
          : 'Vérifier l’installation des navigateurs de Playwright.';
      }

      throw new Error(`Chromium n’a pas pu démarrer. ${conseil}\n\nDétail : ${message}`);
    });

  return ouvertureEnCours;
}

/**
 * Éprouve la sortie PDF au démarrage, dans le processus du service.
 *
 * Chromium est la pièce la plus fragile d'une installation, et c'est la seule dont
 * l'échec ne se voit qu'au moment où un client attend son dossier. Un contrôle mené
 * depuis l'extérieur — un binaire lancé à la main, un autre HOME, d'autres arguments —
 * peut passer alors que le service échoue : c'est exactement ce qui s'est produit. Celui-ci
 * emprunte le vrai chemin, avec le vrai cloisonnement, et le dit tout de suite.
 *
 * Il n'empêche jamais le démarrage : un Previs qui sert les dossiers sans produire de PDF
 * vaut mieux qu'un Previs arrêté.
 */
export async function eprouverSortiePdf(): Promise<{ ok: boolean; message: string }> {
  try {
    const navigateur = await obtenirNavigateur();
    const page = await navigateur.newPage();
    try {
      await page.setContent('<!doctype html><title>essai</title><p>Previs</p>');
      const pdf = await page.pdf({ format: 'A4' });
      if (pdf.length < 500) throw new Error(`document anormalement court (${pdf.length} octets)`);
      etatSortiePdf.ok = true;
      etatSortiePdf.message = `${pdf.length} octets produits`;
      return etatSortiePdf as { ok: boolean; message: string };
    } finally {
      await page.close();
    }
  } catch (erreur) {
    etatSortiePdf.ok = false;
    etatSortiePdf.message = erreur instanceof Error ? erreur.message : String(erreur);
    return { ok: false, message: etatSortiePdf.message };
  }
}

/** Ferme le navigateur partagé, à l'arrêt du serveur. */
export async function fermerNavigateur(): Promise<void> {
  const courant = navigateur;
  navigateur = null;
  if (courant?.isConnected()) await courant.close();
}

/** Deux Chromium à la fois, douze demandes en attente au plus. */
const file = new FileImpressions(2, 12);
/** Délai au-delà duquel une impression est abandonnée, en millisecondes. */
const DELAI_IMPRESSION = 60_000;

/**
 * Produit le dossier prévisionnel au format PDF, à la charte TARN COMPTA.
 *
 * Le seul bandeau répété est le pied de page, confié au gabarit natif de Chromium :
 * lui seul connaît le nombre total de pages, et lui seul se place de façon fiable dans
 * la marge basse. Il figure sur les vingt-six pages, couverture comprise ; c'est la
 * feuille de style qui lui réserve sa bande sur les pages à fond perdu.
 *
 * Deux plafonds encadrent ce chemin : deux impressions à la fois au plus, et soixante
 * secondes par impression. « file.ts » porte les deux mécanismes, mais aucune des deux
 * valeurs : elles sont posées juste au-dessus, au point d'appel.
 */
export async function genererPdf(
  dossier: Dossier,
  resultats: Resultats,
  options: OptionsDocument = {},
): Promise<Uint8Array> {
  const cabinet = options.cabinet ?? CABINET_PAR_DEFAUT;
  const html = construireHtml(dossier, resultats, options);

  await file.prendre();
  let contexte: import('playwright-core').BrowserContext | null = null;
  try {
    const b = await obtenirNavigateur();
    // Le document est entièrement statique : couper JavaScript retire au rendu tout
    // moyen d'exécuter du code, quand bien même une échappée manquerait dans le gabarit.
    contexte = await b.newContext({ locale: 'fr-FR', javaScriptEnabled: false });

    /*
     * Le blocage réseau, et c'est ici qu'il vit.
     *
     * Les drapeaux de lancement ne coupent que les services d'arrière-plan de Chromium :
     * une balise « img » ou « @import » dans le document aurait été honorée, et le seul
     * rempart entre un contenu de dossier hostile et une requête sortante depuis le VPS
     * aurait été l'échappement des gabarits. Ici, toute requête de la page est refusée à
     * la source. Les polices et les logos n'en souffrent pas : ils sont incorporés en
     * « data: », que l'interception ne voit pas.
     */
    await contexte.route('**/*', (route) => route.abort('blockedbyclient'));

    const page = await contexte.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const impression = page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      // Un en-tête vide, et non l'absence d'en-tête : « displayHeaderFooter » impose les deux
      // gabarits, et celui de Chromium par défaut imprimerait le titre du document et son URL.
      headerTemplate: '<span></span>',
      footerTemplate: construirePied(dossier, resultats, cabinet),
    });

    /*
     * Un délai, sans quoi une impression bloquée fait pendre la requête HTTP pour toujours
     * et retient son jeton : deux dossiers pathologiques suffisaient à fermer l'export pour
     * tout le monde, sans que rien ne le signale. « page.pdf() » n'accepte pas de délai —
     * on le lui impose de l'extérieur, et la fermeture du contexte en « finally » avorte le
     * rendu resté en cours.
     */
    return await avecDelai(impression, DELAI_IMPRESSION);
  } finally {
    // Fermé dans tous les cas, y compris si « newPage() » échoue — ce qui est précisément
    // ce qui arrive sous pression mémoire, et laissait alors un contexte derrière lui.
    if (contexte) await contexte.close().catch(() => undefined);
    file.rendre();
  }
}

export { construireHtml, construirePied };
export type { OptionsDocument };

import compression from '@fastify/compress';
import cookie from '@fastify/cookie';
import statique from '@fastify/static';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { ServiceAuthentification } from './auth.js';
import { journaliser, ouvrirBase, purgerSessions, type BaseDonnees } from './base.js';
import { ServiceCabinet } from './cabinet.js';
import { ServiceClesAcces } from './cles.js';
import { chargerConfiguration, type Configuration } from './config.js';
import { DepotSqlite } from './depot.js';
import { monterMcpHttp } from './mcpHttp.js';
import { ServiceOauth } from './oauth.js';
import { enregistrerRoutesOauth } from './oauthRoutes.js';
import { eprouverSortiePdf, fermerNavigateur } from './pdf/index.js';
import { enregistrerRoutes } from './routes.js';
import { LimiteurDebit } from './securite.js';

export interface Application {
  app: import('fastify').FastifyInstance;
  base: BaseDonnees;
  auth: ServiceAuthentification;
  depot: DepotSqlite;
  cabinet: ServiceCabinet;
  oauth: ServiceOauth;
  cles: ServiceClesAcces;
}

/** Construit l'application Fastify complète, sans l'écouter : utile aussi pour les essais. */
export async function construireApplication(config: Configuration): Promise<Application> {
  const base = ouvrirBase(config.cheminBase);
  const auth = new ServiceAuthentification(base);
  const depot = new DepotSqlite(base);
  const cabinet = new ServiceCabinet(base);
  const oauth = new ServiceOauth(base);
  // Le nom affiché par le système au moment du geste est celui du cabinet, tel qu'il est
  // renseigné : il est relu à chaque cérémonie plutôt que figé au démarrage.
  const cles = new ServiceClesAcces(base, config.urlPublique, () => cabinet.lire().nom);

  const app = Fastify({
    logger: { level: config.niveauJournal },
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: config.confianceProxy,
  });

  ajouterEntetesSecurite(app, config);

  // Un export lance un rendu Chromium : trente par quart d'heure et par compte. Le
  // compteur est créé ici, et non dans les routes, parce qu'il doit être le MÊME pour la
  // route HTTP et pour l'outil MCP « generer_pdf ». Deux compteurs séparés offriraient au
  // porteur d'un jeton deux budgets au lieu d'un.
  const debitPdf = new LimiteurDebit(30, 15 * 60 * 1000);

  // Un dossier volumineux pèse une cinquantaine de kilo-octets et ses états calculés
  // le double : la compression divise ces échanges par dix sur une liaison lente.
  await app.register(compression, { global: true, threshold: 1024, encodings: ['br', 'gzip', 'deflate'] });
  await app.register(cookie, { secret: config.secretSession });
  enregistrerRoutes(app, { base, auth, depot, cabinet, oauth, cles, config, debitPdf });
  await enregistrerRoutesOauth(app, { base, auth, oauth, cabinet, config });

  if (config.mcpHttpActif) {
    await monterMcpHttp(app, {
      auth,
      depot,
      oauth,
      debitPdf,
      urlPublique: config.urlPublique,
    });
  }

  // ─── Interface construite ───────────────────────────────────────────────────
  if (existsSync(config.cheminStatique)) {
    // Vite appose une empreinte au nom des fichiers de /assets : ils peuvent être
    // mis en cache indéfiniment. index.html, lui, ne doit jamais l'être.
    await app.register(statique, {
      root: config.cheminStatique,
      prefix: '/',
      // L'en-tête par défaut du greffon est neutralisé pour être posé ici seul.
      cacheControl: false,
      setHeaders(reponse, chemin) {
        const durable = chemin.includes(`${sep}assets${sep}`) && !chemin.endsWith('.html');
        reponse.header('cache-control', durable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Toute route inconnue hors API renvoie l'interface : le routage est côté client.
    app.setNotFoundHandler((requete, reponse) => {
      if (requete.url.startsWith('/api') || requete.url.startsWith('/mcp')) {
        return reponse.code(404).send({ erreur: 'Route inconnue.', code: 'introuvable' });
      }
      return reponse.type('text/html').sendFile('index.html');
    });
  }

  purgerSessions(base);
  const purge = setInterval(() => purgerSessions(base), 6 * 3600 * 1000);
  purge.unref();

  app.addHook('onClose', async () => {
    clearInterval(purge);
    await fermerNavigateur();
    base.close();
  });

  return { app, base, auth, depot, cabinet, oauth, cles };
}

/**
 * En-têtes de sécurité posés par le service lui-même.
 *
 * nginx les ajoute déjà en production, mais le serveur peut aussi être exposé
 * directement — une machine du cabinet, un essai — et la protection ne doit pas
 * dépendre du bon paramétrage d'une couche en amont.
 *
 * La politique de contenu est stricte : l'interface ne charge ni script en ligne,
 * ni ressource distante. Seules les feuilles de style en ligne sont tolérées, React
 * posant des attributs `style` sur les éléments qu'il rend.
 */
function ajouterEntetesSecurite(app: import('fastify').FastifyInstance, config: Configuration): void {
  const politique = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  /*
   * HSTS, posé par l'application et non seulement par le frontal.
   *
   * Sans lui, la première visite tapée « previs.tarncompta.fr » part en clair : un
   * intercepteur sur le chemin la garde en clair et lit la session. La redirection du
   * frontal vers HTTPS n'y change rien — elle arrive trop tard, la requête est déjà passée.
   * L'en-tête n'est posé que si l'adresse publique est en HTTPS : un montage local en clair
   * n'a pas à s'interdire lui-même.
   *
   * « preload » n'y est pas volontairement : l'inscription à la liste des navigateurs est
   * un engagement difficile à défaire, qui appartient au cabinet et non au code.
   */
  const hsts = config.urlPublique.startsWith('https://')
    ? 'max-age=31536000; includeSubDomains'
    : '';

  app.addHook('onSend', async (_requete, reponse, charge) => {
    if (hsts) reponse.header('strict-transport-security', hsts);
    // L'écran de consentement OAuth pose la sienne, plus étroite, mais qui doit
    // autoriser la soumission du formulaire vers l'adresse de retour du client :
    // ne pas l'écraser.
    if (!reponse.getHeader('content-security-policy')) {
      reponse.header('content-security-policy', politique);
    }
    reponse.header('x-content-type-options', 'nosniff');
    reponse.header('x-frame-options', 'DENY');
    reponse.header('referrer-policy', 'strict-origin-when-cross-origin');
    reponse.header('cross-origin-opener-policy', 'same-origin');
    reponse.header('cross-origin-resource-policy', 'same-origin');
    reponse.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    return charge;
  });
}

/**
 * Crée le compte administrateur au tout premier démarrage.
 *
 * Sans mot de passe fourni, aucun compte n'est créé : mieux vaut un service
 * inutilisable qu'un accès ouvert avec un mot de passe deviné.
 */
async function amorcer(auth: ServiceAuthentification, config: Configuration): Promise<void> {
  if (auth.compterUtilisateurs() > 0) return;

  if (!config.bootstrap.email || !config.bootstrap.motDePasse) {
    console.warn(
      '\n  Aucun compte n’existe et BOOTSTRAP_ADMIN_PASSWORD n’est pas renseigné.\n' +
        '  Renseigner BOOTSTRAP_ADMIN_EMAIL et BOOTSTRAP_ADMIN_PASSWORD dans le fichier .env,\n' +
        '  puis redémarrer le service pour créer le premier compte administrateur.\n',
    );
    return;
  }

  await auth.creerUtilisateur({
    email: config.bootstrap.email,
    nom: config.bootstrap.nom,
    motDePasse: config.bootstrap.motDePasse,
    role: 'admin',
  });
  console.log(`  Compte administrateur créé : ${config.bootstrap.email}`);
}

async function demarrer(): Promise<void> {
  const config = chargerConfiguration();
  const { app, base, auth } = await construireApplication(config);
  await amorcer(auth, config);

  const arreter = async (signal: string) => {
    console.log(`\n  Signal ${signal} reçu, arrêt du service.`);
    journaliser(base, { utilisateur: '', origine: 'systeme', action: 'arret_service' });
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void arreter('SIGTERM'));
  process.on('SIGINT', () => void arreter('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  console.log(`  Previs écoute sur http://${config.host}:${config.port}`);
  console.log(`  Base de données : ${config.cheminBase}`);
  if (config.mcpHttpActif) console.log(`  Serveur MCP monté sur ${config.urlPublique}/mcp`);

  // La sortie PDF est éprouvée ici, dans le processus du service : c'est le seul endroit
  // où le cloisonnement de l'unité, le compte, l'environnement et les arguments réels sont
  // tous réunis. Le premier navigateur reste ouvert, ce qui rend le premier export instantané.
  const pdf = await eprouverSortiePdf();
  if (pdf.ok) {
    console.log(`  Sortie PDF éprouvée : ${pdf.message}`);
  } else {
    console.error(
      `\n  La sortie PDF ne fonctionne pas. Les dossiers restent consultables et modifiables,\n` +
        `  mais aucun PDF ne pourra être produit.\n\n  ${pdf.message}\n`,
    );
  }

  // Le verdict est aussi déposé à côté de la base : l'installateur le lit en root, ce
  // qui l'éprouve enfin sur une mise à jour et pas seulement à la première installation.
  // Il n'est pas publié sur /api/sante : la route publique ne doit rien révéler du
  // service, et un essai veille à ce que sa réponse ne s'étoffe pas.
  try {
    writeFileSync(
      resolve(dirname(config.cheminBase), 'etat-pdf'),
      `${pdf.ok ? 'operationnelle' : 'indisponible'}\n${pdf.message}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Un répertoire de données en lecture seule ne doit pas empêcher le service de servir.
  }

  // Les métadonnées OAuth publient PUBLIC_URL telle quelle. En clair, un connecteur
  // refuse le serveur d'autorisation sans le dire clairement : mieux vaut l'annoncer ici.
  if (config.production && !config.urlPublique.startsWith('https://')) {
    console.warn(
      `\n  PUBLIC_URL vaut « ${config.urlPublique} », en clair.\n` +
        '  Les connecteurs OAuth (claude.ai, Claude Desktop) exigent HTTPS et refuseront\n' +
        '  ce serveur d’autorisation. Renseigner l’adresse publique en https dans .env.\n',
    );
  }
}

// Le module est aussi importable pour les essais : on ne démarre que s'il est exécuté.
const executeDirectement =
  process.argv[1] !== undefined &&
  (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
    import.meta.url === `file://${process.argv[1]}`);

if (executeDirectement) {
  demarrer().catch((erreur) => {
    console.error('  Le service n’a pas pu démarrer :', erreur instanceof Error ? erreur.message : erreur);
    process.exit(1);
  });
}

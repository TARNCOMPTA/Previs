import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Charge un fichier `.env` sans dépendance externe : les lignes vides et les
 * commentaires sont ignorés, les variables déjà présentes dans l'environnement
 * ne sont jamais écrasées.
 */
function chargerEnv(chemin: string): void {
  if (!existsSync(chemin)) return;
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const nette = ligne.trim();
    if (!nette || nette.startsWith('#')) continue;
    const separateur = nette.indexOf('=');
    if (separateur <= 0) continue;
    const cle = nette.slice(0, separateur).trim();
    let valeur = nette.slice(separateur + 1).trim();
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }
}

export interface Configuration {
  port: number;
  host: string;
  urlPublique: string;
  secretSession: string;
  cheminBase: string;
  cheminStatique: string;
  cheminChromium: string;
  cookiesSecurises: boolean;
  /** Réseaux dont l'en-tête `X-Forwarded-For` fait foi pour déterminer l'adresse du client. */
  confianceProxy: string;
  /** Niveau de journalisation Fastify (`silent` pour les essais). */
  niveauJournal: string;
  mcpHttpActif: boolean;
  production: boolean;
  bootstrap: { email: string; motDePasse: string; nom: string };
}

export function chargerConfiguration(racine = process.cwd()): Configuration {
  chargerEnv(resolve(racine, '.env'));

  const production = process.env.NODE_ENV === 'production';
  const secretSession = process.env.SESSION_SECRET ?? '';

  if (production && secretSession.length < 32) {
    throw new Error(
      'SESSION_SECRET est absent ou trop court. Générer un secret avec :\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? '0.0.0.0',
    urlPublique: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,
    secretSession: secretSession || 'secret-de-developpement-non-securise',
    cheminBase: resolve(racine, process.env.DATABASE_PATH ?? './data/previs.db'),
    cheminStatique: resolve(racine, process.env.STATIC_PATH ?? './packages/web/dist'),
    cheminChromium: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    cookiesSecurises: (process.env.SECURE_COOKIES ?? String(production)) === 'true',
    // Faire confiance à tout le monde laisserait n'importe quel client forger son
    // adresse et contourner ainsi la limitation des tentatives de connexion. Seuls
    // le proxy local et un réseau de conteneurs privé sont crus par défaut.
    confianceProxy: process.env.TRUST_PROXY ?? 'loopback, uniquelocal',
    niveauJournal: process.env.LOG_LEVEL ?? (production ? 'info' : 'warn'),
    mcpHttpActif: (process.env.MCP_HTTP_ENABLED ?? 'true') === 'true',
    production,
    bootstrap: {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL ?? '',
      motDePasse: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',
      nom: process.env.BOOTSTRAP_ADMIN_NOM ?? 'Administrateur',
    },
  };
}

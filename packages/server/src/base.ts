import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type BaseDonnees = Database.Database;

/**
 * Ouvre la base SQLite et applique les migrations.
 *
 * Le mode WAL autorise des lectures concurrentes pendant qu'une écriture est en
 * cours : l'interface peut donc rafraîchir un dossier au moment même où le serveur
 * MCP y écrit. Les clés étrangères sont activées pour que la suppression d'un
 * dossier emporte son historique de versions.
 */
export function ouvrirBase(chemin: string): BaseDonnees {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
  const base = new Database(chemin);
  base.pragma('journal_mode = WAL');
  base.pragma('foreign_keys = ON');
  base.pragma('busy_timeout = 5000');
  migrer(base);
  if (chemin !== ':memory:') restreindreAcces(chemin);
  return base;
}

/**
 * Réserve la base au compte qui fait tourner le service.
 *
 * Le fichier contient les dossiers des clients du cabinet et les empreintes des
 * mots de passe : la permission par défaut de SQLite (0644) l'exposerait à tout
 * compte du serveur. Les journaux WAL portent les mêmes données.
 */
function restreindreAcces(chemin: string): void {
  for (const fichier of [chemin, `${chemin}-wal`, `${chemin}-shm`]) {
    try {
      if (existsSync(fichier)) chmodSync(fichier, 0o600);
    } catch {
      // Un système de fichiers sans permissions POSIX (montage Windows) : sans objet.
    }
  }
  try {
    chmodSync(dirname(chemin), 0o700);
  } catch {
    // Idem : le répertoire peut appartenir à l'hôte dans un conteneur.
  }
}

/** Migrations idempotentes, exécutées à chaque démarrage. */
function migrer(base: BaseDonnees): void {
  base.exec(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
      id                  TEXT PRIMARY KEY,
      email               TEXT NOT NULL UNIQUE,
      nom                 TEXT NOT NULL,
      empreinte           TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'collaborateur',
      actif               INTEGER NOT NULL DEFAULT 1,
      cree_le             TEXT NOT NULL,
      derniere_connexion  TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      utilisateur_id TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      cree_le        TEXT NOT NULL,
      expire_le      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_utilisateur ON sessions(utilisateur_id);

    CREATE TABLE IF NOT EXISTS jetons (
      id                    TEXT PRIMARY KEY,
      libelle               TEXT NOT NULL,
      empreinte             TEXT NOT NULL UNIQUE,
      apercu                TEXT NOT NULL,
      utilisateur_id        TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      cree_le               TEXT NOT NULL,
      expire_le             TEXT,
      derniere_utilisation  TEXT
    );

    CREATE TABLE IF NOT EXISTS dossiers (
      id                  TEXT PRIMARY KEY,
      nom                 TEXT NOT NULL,
      contenu             TEXT NOT NULL,
      version             INTEGER NOT NULL DEFAULT 1,
      client              TEXT NOT NULL DEFAULT '',
      regime              TEXT NOT NULL DEFAULT 'IS',
      type_dossier        TEXT NOT NULL DEFAULT 'creation',
      nb_exercices        INTEGER NOT NULL DEFAULT 3,
      annee_debut         TEXT NOT NULL DEFAULT '',
      ca_premier_exercice REAL NOT NULL DEFAULT 0,
      coherent            INTEGER NOT NULL DEFAULT 1,
      cree_le             TEXT NOT NULL,
      modifie_le          TEXT NOT NULL,
      modifie_par         TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_dossiers_modifie ON dossiers(modifie_le DESC);

    CREATE TABLE IF NOT EXISTS versions_dossier (
      dossier_id  TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      version     INTEGER NOT NULL,
      contenu     TEXT NOT NULL,
      auteur      TEXT NOT NULL DEFAULT '',
      commentaire TEXT NOT NULL DEFAULT '',
      origine     TEXT NOT NULL DEFAULT 'interface',
      cree_le     TEXT NOT NULL,
      PRIMARY KEY (dossier_id, version)
    );

    CREATE TABLE IF NOT EXISTS journal_audit (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      horodatage     TEXT NOT NULL,
      utilisateur    TEXT NOT NULL DEFAULT '',
      origine        TEXT NOT NULL DEFAULT '',
      action         TEXT NOT NULL,
      cible          TEXT NOT NULL DEFAULT '',
      detail         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_horodatage ON journal_audit(horodatage);
  `);
}

/** Consigne une action dans le journal d'audit. */
export function journaliser(
  base: BaseDonnees,
  entree: { utilisateur: string; origine: string; action: string; cible?: string; detail?: string },
): void {
  base
    .prepare(
      `INSERT INTO journal_audit (horodatage, utilisateur, origine, action, cible, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      entree.utilisateur,
      entree.origine,
      entree.action,
      entree.cible ?? '',
      entree.detail ?? '',
    );
}

/** Supprime les sessions expirées. Appelé au démarrage et périodiquement. */
export function purgerSessions(base: BaseDonnees): number {
  return base.prepare('DELETE FROM sessions WHERE expire_le < ?').run(new Date().toISOString())
    .changes;
}

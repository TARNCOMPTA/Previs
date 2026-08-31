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

    CREATE TABLE IF NOT EXISTS cabinet (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      contenu   TEXT NOT NULL,
      modifie_le TEXT NOT NULL
    );

    -- ─── Autorisation OAuth du point d'entrée MCP ──────────────────────────
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id       TEXT PRIMARY KEY,
      nom             TEXT NOT NULL DEFAULT '',
      redirect_uris   TEXT NOT NULL,
      portee          TEXT NOT NULL DEFAULT '',
      cree_le         TEXT NOT NULL,
      derniere_utilisation TEXT
    );

    -- Les codes sont à usage unique : la colonne « consomme_le » interdit le rejeu
    -- plutôt que de supprimer la ligne, ce qui permet de repérer une tentative.
    CREATE TABLE IF NOT EXISTS oauth_codes (
      empreinte       TEXT PRIMARY KEY,
      client_id       TEXT NOT NULL,
      utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      redirect_uri    TEXT NOT NULL,
      code_challenge  TEXT NOT NULL,
      portee          TEXT NOT NULL DEFAULT '',
      ressource       TEXT NOT NULL DEFAULT '',
      expire_le       TEXT NOT NULL,
      cree_le         TEXT NOT NULL,
      consomme_le     TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_jetons (
      empreinte       TEXT PRIMARY KEY,
      genre           TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      portee          TEXT NOT NULL DEFAULT '',
      ressource       TEXT NOT NULL DEFAULT '',
      expire_le       TEXT NOT NULL,
      cree_le         TEXT NOT NULL,
      revoque_le      TEXT,
      /* Rotation des jetons de rafraîchissement : celui qui remplace désigne son aîné,
         ce qui permet de détecter le rejeu d'un jeton déjà échangé. */
      remplace        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_jetons_utilisateur ON oauth_jetons(utilisateur_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_jetons_expire ON oauth_jetons(expire_le);

    -- Demandes d'autorisation en cours : l'écran de consentement s'y réfère par un
    -- identifiant opaque, plutôt que de recopier les paramètres dans un formulaire.
    CREATE TABLE IF NOT EXISTS oauth_demandes (
      id              TEXT PRIMARY KEY,
      parametres      TEXT NOT NULL,
      expire_le       TEXT NOT NULL,
      cree_le         TEXT NOT NULL
    );

    -- ─── Clés d'accès (WebAuthn) ────────────────────────────────────────────
    -- Rien ici n'est secret : une clé publique et un identifiant de justificatif sont
    -- des données publiques par construction. Ce qui protège, c'est que la clé privée
    -- ne quitte jamais l'appareil du porteur — pas la confidentialité de cette table.
    -- L'identifiant du justificatif est UNIQUE dans toute la base : l'attestation
    -- n'étant pas demandée, il est choisi par le client, et sans cette contrainte un
    -- compte pourrait déclarer celui d'un collègue en l'accompagnant de sa propre clé.
    CREATE TABLE IF NOT EXISTS cles_acces (
      id                   TEXT PRIMARY KEY,
      utilisateur_id       TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
      identifiant_cle      TEXT NOT NULL UNIQUE,
      cle_publique         TEXT NOT NULL,
      compteur             INTEGER NOT NULL DEFAULT 0,
      transports           TEXT NOT NULL DEFAULT '',
      libelle              TEXT NOT NULL DEFAULT '',
      synchronisee         INTEGER NOT NULL DEFAULT 0,
      cree_le              TEXT NOT NULL,
      derniere_utilisation TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cles_utilisateur ON cles_acces(utilisateur_id);

    -- Le défi d'une cérémonie reste au serveur : le client n'en reçoit qu'un
    -- identifiant opaque. Un défi que le client renverrait serait un défi qu'il
    -- choisit, et une assertion captée une fois vaudrait indéfiniment.
    CREATE TABLE IF NOT EXISTS webauthn_defis (
      id             TEXT PRIMARY KEY,
      defi           TEXT NOT NULL,
      genre          TEXT NOT NULL CHECK (genre IN ('enregistrement', 'connexion')),
      utilisateur_id TEXT REFERENCES utilisateurs(id) ON DELETE CASCADE,
      expire_le      TEXT NOT NULL,
      cree_le        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_defis_expiration ON webauthn_defis(expire_le);

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

  ajouterColonne(base, 'dossiers', 'logo', "TEXT NOT NULL DEFAULT ''");
}

/**
 * Ajoute une colonne si elle manque.
 *
 * SQLite ne connaît pas `ADD COLUMN IF NOT EXISTS` : on interroge le schéma plutôt
 * que d'avaler l'erreur, pour qu'un vrai échec de migration reste visible.
 */
function ajouterColonne(
  base: BaseDonnees,
  table: string,
  colonne: string,
  definition: string,
): void {
  const colonnes = base.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (colonnes.some((c) => c.name === colonne)) return;
  base.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
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
  const maintenant = new Date().toISOString();
  const n = base.prepare('DELETE FROM sessions WHERE expire_le < ?').run(maintenant).changes;

  // Les traces de l'autorisation OAuth expirent de la même façon. Les codes consommés
  // sont gardés une journée : leur seule utilité passée est de repérer un rejeu.
  base.prepare("DELETE FROM oauth_codes WHERE expire_le < ? AND (consomme_le IS NULL OR consomme_le < ?)")
    .run(maintenant, new Date(Date.now() - 86400000).toISOString());
  base.prepare('DELETE FROM oauth_demandes WHERE expire_le < ?').run(maintenant);
  base.prepare('DELETE FROM oauth_jetons WHERE expire_le < ?').run(maintenant);

  // Le point d'entrée qui émet un défi de connexion est nécessairement public : sans
  // cette purge, une boucle anonyme ferait grossir la table jusqu'à remplir le disque.
  base.prepare('DELETE FROM webauthn_defis WHERE expire_le < ?').run(maintenant);
  return n;
}

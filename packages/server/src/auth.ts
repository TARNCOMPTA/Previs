import {
  ENTETE_JETON,
  PREFIXE_JETON,
  type Auteur,
  type Role,
  type Utilisateur,
} from '@previs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BaseDonnees } from './base.js';
import {
  empreinteJeton,
  hacherMotDePasse,
  nouvelIdentifiant,
  nouvelIdentifiantSession,
  verifierMotDePasse,
} from './securite.js';

export const NOM_COOKIE = 'previs_session';
export const DUREE_SESSION_JOURS = 30;

interface LigneUtilisateur {
  id: string;
  email: string;
  nom: string;
  empreinte: string;
  role: string;
  actif: number;
  cree_le: string;
  derniere_connexion: string | null;
}

function versUtilisateur(ligne: LigneUtilisateur): Utilisateur {
  return {
    id: ligne.id,
    email: ligne.email,
    nom: ligne.nom,
    role: ligne.role as Role,
    creeLe: ligne.cree_le,
    derniereConnexion: ligne.derniere_connexion,
    actif: ligne.actif === 1,
  };
}

/** Identité résolue d'une requête : par session de navigateur ou par jeton d'API. */
export interface Identite {
  utilisateur: Utilisateur;
  origine: 'interface' | 'mcp';
}

export function auteurDe(identite: Identite): Auteur {
  return { id: identite.utilisateur.id, nom: identite.utilisateur.nom, origine: identite.origine };
}

export class ServiceAuthentification {
  constructor(private readonly base: BaseDonnees) {}

  async creerUtilisateur(entree: {
    email: string;
    nom: string;
    motDePasse: string;
    role: Role;
  }): Promise<Utilisateur> {
    const id = nouvelIdentifiant('utl');
    const empreinte = await hacherMotDePasse(entree.motDePasse);
    this.base
      .prepare(
        `INSERT INTO utilisateurs (id, email, nom, empreinte, role, actif, cree_le)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, entree.email.toLowerCase().trim(), entree.nom, empreinte, entree.role, new Date().toISOString());
    return this.lireUtilisateur(id)!;
  }

  lireUtilisateur(id: string): Utilisateur | null {
    const ligne = this.base.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id) as
      | LigneUtilisateur
      | undefined;
    return ligne ? versUtilisateur(ligne) : null;
  }

  listerUtilisateurs(): Utilisateur[] {
    const lignes = this.base
      .prepare('SELECT * FROM utilisateurs ORDER BY nom')
      .all() as LigneUtilisateur[];
    return lignes.map(versUtilisateur);
  }

  compterUtilisateurs(): number {
    return (this.base.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get() as { n: number }).n;
  }

  /** Vérifie les identifiants et ouvre une session. Renvoie null si l'authentification échoue. */
  async connecter(email: string, motDePasse: string): Promise<{ utilisateur: Utilisateur; session: string } | null> {
    const ligne = this.base
      .prepare('SELECT * FROM utilisateurs WHERE email = ?')
      .get(email.toLowerCase().trim()) as LigneUtilisateur | undefined;

    // Un mot de passe est tout de même vérifié sur un compte inconnu, pour que la
    // durée de la réponse ne révèle pas l'existence de l'adresse.
    const empreinte = ligne?.empreinte ?? (await hacherMotDePasse('empreinte-de-comparaison'));
    const valide = await verifierMotDePasse(motDePasse, empreinte);
    if (!ligne || !valide || ligne.actif !== 1) return null;

    return { utilisateur: versUtilisateur(ligne), session: this.ouvrirSession(ligne.id) };
  }

  /**
   * Ouvre une session pour un compte déjà authentifié, et rend son identifiant en clair.
   *
   * Un seul chemin, quel que soit le moyen employé — mot de passe ou clé d'accès. Un
   * second chemin recopié à la main est l'endroit où l'on oublie que seule l'empreinte
   * de l'identifiant doit être conservée.
   */
  ouvrirSession(utilisateurId: string): string {
    // Seule l'empreinte de l'identifiant de session est conservée : une copie de la
    // base — une sauvegarde égarée, par exemple — ne permet pas de rejouer une session.
    const session = nouvelIdentifiantSession();
    const expiration = new Date(Date.now() + DUREE_SESSION_JOURS * 86400000).toISOString();
    this.base
      .prepare('INSERT INTO sessions (id, utilisateur_id, cree_le, expire_le) VALUES (?, ?, ?, ?)')
      .run(empreinteJeton(session), utilisateurId, new Date().toISOString(), expiration);
    this.base
      .prepare('UPDATE utilisateurs SET derniere_connexion = ? WHERE id = ?')
      .run(new Date().toISOString(), utilisateurId);
    return session;
  }

  deconnecter(session: string): void {
    this.base.prepare('DELETE FROM sessions WHERE id = ?').run(empreinteJeton(session));
  }

  /** Résout une session valide et non expirée. */
  parSession(session: string): Utilisateur | null {
    const ligne = this.base
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
         WHERE s.id = ? AND s.expire_le > ? AND u.actif = 1`,
      )
      .get(empreinteJeton(session), new Date().toISOString()) as LigneUtilisateur | undefined;
    return ligne ? versUtilisateur(ligne) : null;
  }

  /**
   * Vérifie un mot de passe sans ouvrir de session.
   *
   * `connecter()` en ouvrait une à chaque changement de mot de passe, laissant en base
   * des sessions orphelines jamais utilisées.
   */
  async verifierIdentifiants(email: string, motDePasse: string): Promise<boolean> {
    const ligne = this.base
      .prepare('SELECT * FROM utilisateurs WHERE email = ?')
      .get(email.toLowerCase().trim()) as LigneUtilisateur | undefined;
    const empreinte = ligne?.empreinte ?? (await hacherMotDePasse('empreinte-de-comparaison'));
    const valide = await verifierMotDePasse(motDePasse, empreinte);
    return Boolean(ligne) && valide && ligne?.actif === 1;
  }

  /** Nombre de comptes administrateurs encore actifs. */
  compterAdministrateurs(): number {
    return (
      this.base
        .prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1")
        .get() as { n: number }
    ).n;
  }

  /** Résout un jeton d'API et met à jour sa date de dernière utilisation. */
  parJeton(jeton: string): Utilisateur | null {
    if (!jeton.startsWith(PREFIXE_JETON)) return null;
    const empreinte = empreinteJeton(jeton);
    const ligne = this.base
      .prepare(
        `SELECT u.*, j.id AS jeton_id, j.expire_le AS jeton_expire FROM jetons j
         JOIN utilisateurs u ON u.id = j.utilisateur_id
         WHERE j.empreinte = ? AND u.actif = 1`,
      )
      .get(empreinte) as (LigneUtilisateur & { jeton_id: string; jeton_expire: string | null }) | undefined;
    if (!ligne) return null;
    if (ligne.jeton_expire && ligne.jeton_expire < new Date().toISOString()) return null;

    this.base
      .prepare('UPDATE jetons SET derniere_utilisation = ? WHERE id = ?')
      .run(new Date().toISOString(), ligne.jeton_id);
    return versUtilisateur(ligne);
  }

  async changerMotDePasse(id: string, motDePasse: string): Promise<void> {
    const empreinte = await hacherMotDePasse(motDePasse);
    this.base.prepare('UPDATE utilisateurs SET empreinte = ? WHERE id = ?').run(empreinte, id);
    // Toutes les sessions ouvertes sont fermées : un changement de mot de passe doit
    // déconnecter les appareils encore authentifiés avec l'ancien.
    this.base.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(id);
  }
}

/**
 * Extrait le jeton d'API d'une requête, par l'un ou l'autre en-tête.
 *
 * `x-previs-token` est l'en-tête propre au logiciel ; `Authorization: Bearer` est
 * celui que savent envoyer les clients MCP génériques et les formulaires de
 * connecteur, qui ne permettent pas d'ajouter un en-tête arbitraire. Les deux offrent
 * la même protection contre les requêtes intersites : une page tierce ne peut poser
 * ni l'un ni l'autre sans un contrôle préalable que le serveur n'accorde pas.
 */
export function jetonDeRequete(requete: FastifyRequest): string | null {
  const propre = requete.headers[ENTETE_JETON];
  const direct = Array.isArray(propre) ? propre[0] : propre;
  if (direct) return direct;

  const autorisation = requete.headers.authorization;
  const brut = Array.isArray(autorisation) ? autorisation[0] : autorisation;
  if (!brut) return null;
  const correspondance = /^Bearer[ ]+(.+)$/i.exec(brut.trim());
  return correspondance ? correspondance[1].trim() : null;
}

/** Vrai si la requête porte un jeton, quel que soit l'en-tête employé. */
export function porteUnJeton(requete: FastifyRequest): boolean {
  return jetonDeRequete(requete) !== null;
}

/** Résout l'identité d'une requête, par jeton d'API en priorité puis par session. */
export function identifier(
  service: ServiceAuthentification,
  requete: FastifyRequest,
): Identite | null {
  const jeton = jetonDeRequete(requete);
  if (jeton) {
    const utilisateur = service.parJeton(jeton);
    return utilisateur ? { utilisateur, origine: 'mcp' } : null;
  }

  const cookies = (requete as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const session = cookies?.[NOM_COOKIE];
  if (!session) return null;
  const utilisateur = service.parSession(session);
  return utilisateur ? { utilisateur, origine: 'interface' } : null;
}

/** Refuse la requête si l'identité manque ou si le rôle ne permet pas l'action. */
export function exiger(
  identite: Identite | null,
  reponse: FastifyReply,
  options: { ecriture?: boolean; admin?: boolean; navigateur?: boolean } = {},
): identite is Identite {
  if (!identite) {
    reponse.code(401).send({ erreur: 'Authentification requise.', code: 'non_authentifie' });
    return false;
  }
  // Actions qui touchent au moyen de se connecter : elles exigent une session ouverte
  // dans l'interface, sans exiger le droit d'écrire. Un jeton d'API vit en clair dans un
  // fichier de configuration ; lui laisser changer un mot de passe ou poser une clé
  // d'accès en ferait une session d'interface durable. Et un compte en lecture seule
  // doit pouvoir changer son propre mot de passe — ce que « ecriture » lui refusait.
  if (options.navigateur && identite.origine !== 'interface') {
    reponse.code(403).send({
      erreur:
        'Cette action se fait depuis une session ouverte dans l’interface, non par jeton d’API.',
      code: 'interdit',
    });
    return false;
  }
  if (options.admin) {
    // Un jeton d'API vit en clair dans un fichier de configuration, sur un poste :
    // il ne doit jamais permettre de gérer les comptes ni d'émettre d'autres jetons,
    // quel que soit le rôle de son titulaire.
    if (identite.origine === 'mcp') {
      reponse.code(403).send({
        erreur:
          'Un jeton d’API ne donne pas accès à l’administration. Utiliser une session ouverte depuis l’interface.',
        code: 'interdit',
      });
      return false;
    }
    if (identite.utilisateur.role !== 'admin') {
      reponse
        .code(403)
        .send({ erreur: 'Cette action est réservée aux administrateurs.', code: 'interdit' });
      return false;
    }
  }
  if (options.ecriture && identite.utilisateur.role === 'lecteur') {
    reponse
      .code(403)
      .send({ erreur: 'Votre compte est en lecture seule.', code: 'interdit' });
    return false;
  }
  return true;
}

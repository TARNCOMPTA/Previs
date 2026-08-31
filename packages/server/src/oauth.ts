import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DUREE_ACCES,
  DUREE_CODE,
  DUREE_RAFRAICHISSEMENT,
  PORTEE_DOSSIERS,
  PREFIXE_ACCES,
  PREFIXE_CODE,
  PREFIXE_RAFRAICHISSEMENT,
  type AutorisationOauth,
  type ClientEnregistre,
  type EnregistrementClient,
  type Utilisateur,
} from '@previs/core';
import type { BaseDonnees } from './base.js';
import { empreinteJeton, nouvelIdentifiant } from './securite.js';

/**
 * Serveur d'autorisation OAuth 2.1 pour le point d'entrée MCP.
 *
 * Trois principes tiennent l'ensemble :
 *
 * 1. **Rien n'est conservé en clair.** Codes, jetons d'accès et jetons de
 *    rafraîchissement ne vivent en base que par leur empreinte SHA-256, comme les
 *    jetons d'API. Une copie de la base ne permet donc pas de rejouer une session.
 * 2. **PKCE est obligatoire, et en S256 seulement.** La méthode « plain » est refusée :
 *    elle ne protège de rien, le vérificateur circulant alors en clair.
 * 3. **Les jetons de rafraîchissement tournent.** Chaque échange en émet un nouveau et
 *    révoque l'ancien ; réutiliser un jeton déjà échangé révoque toute la lignée, ce qui
 *    est le seul moyen de détecter qu'un jeton a fuité.
 */
export class ServiceOauth {
  constructor(private readonly base: BaseDonnees) {}

  // ─── Clients ────────────────────────────────────────────────────────────────

  /**
   * Enregistre un client (RFC 7591).
   *
   * Les clients sont publics : aucun secret n'est émis. Un connecteur est une
   * application distribuée, incapable de garder un secret ; PKCE est ce qui lie le
   * code à celui qui l'a demandé.
   */
  enregistrerClient(demande: EnregistrementClient): ClientEnregistre {
    for (const uri of demande.redirect_uris) this.verifierRedirection(uri);

    const clientId = nouvelIdentifiant('cli');
    const maintenant = new Date();
    this.base
      .prepare(
        `INSERT INTO oauth_clients (client_id, nom, redirect_uris, portee, cree_le)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        clientId,
        demande.client_name ?? '',
        JSON.stringify(demande.redirect_uris),
        PORTEE_DOSSIERS,
        maintenant.toISOString(),
      );

    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(maintenant.getTime() / 1000),
      client_name: demande.client_name ?? '',
      redirect_uris: demande.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: PORTEE_DOSSIERS,
    };
  }

  /**
   * Refuse une adresse de redirection dangereuse.
   *
   * L'adresse est le seul rempart contre le détournement du code : elle doit être en
   * HTTPS, sauf sur la boucle locale où un client de bureau écoute légitimement en
   * clair. Un fragment y est interdit — la spécification l'exige — et l'absence de
   * partie réseau écarterait les schémas comme `javascript:`.
   */
  private verifierRedirection(uri: string): void {
    let analysee: URL;
    try {
      analysee = new URL(uri);
    } catch {
      throw new ErreurOauth('invalid_redirect_uri', `Adresse de redirection illisible : ${uri}`);
    }
    if (analysee.hash) {
      throw new ErreurOauth('invalid_redirect_uri', 'Une adresse de redirection ne porte pas de fragment.');
    }
    const localE = analysee.hostname === 'localhost' || analysee.hostname === '127.0.0.1' || analysee.hostname === '[::1]';
    if (analysee.protocol !== 'https:' && !(analysee.protocol === 'http:' && localE)) {
      throw new ErreurOauth(
        'invalid_redirect_uri',
        'Une adresse de redirection doit être en HTTPS, sauf sur la boucle locale.',
      );
    }
  }

  /**
   * Vrai si ce connecteur n'a jamais obtenu de jeton sur ce serveur.
   *
   * C'est le seul indice dont dispose l'écran de consentement pour distinguer un outil
   * qu'on branche d'un appât enregistré à l'instant : l'enregistrement dynamique est ouvert
   * — un connecteur MCP s'enregistre lui-même — et le nom affiché vient de celui qui demande.
   * La colonne « derniere_utilisation » n'est renseignée qu'à l'émission d'un jeton.
   */
  jamaisAutorise(clientId: string): boolean {
    const ligne = this.base
      .prepare('SELECT derniere_utilisation FROM oauth_clients WHERE client_id = ?')
      .get(clientId) as { derniere_utilisation: string | null } | undefined;
    return !ligne || ligne.derniere_utilisation === null;
  }

  lireClient(clientId: string): { clientId: string; nom: string; redirectUris: string[] } | null {
    const ligne = this.base
      .prepare('SELECT client_id, nom, redirect_uris FROM oauth_clients WHERE client_id = ?')
      .get(clientId) as { client_id: string; nom: string; redirect_uris: string } | undefined;
    if (!ligne) return null;
    return { clientId: ligne.client_id, nom: ligne.nom, redirectUris: JSON.parse(ligne.redirect_uris) };
  }

  /**
   * Vérifie qu'une adresse de redirection est bien celle du client.
   *
   * La comparaison est exacte, caractère par caractère : accepter un préfixe ou un
   * sous-chemin ouvrirait une redirection non désirée vers un domaine contrôlé par
   * l'attaquant, et le code d'autorisation partirait avec.
   */
  redirectionAutorisee(clientId: string, redirectUri: string): boolean {
    const client = this.lireClient(clientId);
    if (!client) return false;
    return client.redirectUris.includes(redirectUri);
  }

  // ─── Demandes d'autorisation en attente de consentement ─────────────────────

  /**
   * Met une demande de côté, le temps que le compte s'authentifie et consente.
   *
   * Les paramètres ne transitent pas par le formulaire : celui-ci ne porte qu'un
   * identifiant opaque. Un formulaire qui les recopierait laisserait à qui le soumet
   * la possibilité de les changer — l'adresse de redirection, notamment.
   */
  deposerDemande(parametres: Record<string, string>): string {
    const id = nouvelIdentifiant('dem');
    this.base
      .prepare('INSERT INTO oauth_demandes (id, parametres, expire_le, cree_le) VALUES (?, ?, ?, ?)')
      .run(
        id,
        JSON.stringify(parametres),
        new Date(Date.now() + DUREE_CODE * 1000).toISOString(),
        new Date().toISOString(),
      );
    return id;
  }

  lireDemande(id: string): Record<string, string> | null {
    const ligne = this.base
      .prepare('SELECT parametres FROM oauth_demandes WHERE id = ? AND expire_le > ?')
      .get(id, new Date().toISOString()) as { parametres: string } | undefined;
    return ligne ? (JSON.parse(ligne.parametres) as Record<string, string>) : null;
  }

  retirerDemande(id: string): void {
    this.base.prepare('DELETE FROM oauth_demandes WHERE id = ?').run(id);
  }

  // ─── Code d'autorisation ────────────────────────────────────────────────────

  emettreCode(entree: {
    clientId: string;
    utilisateurId: string;
    redirectUri: string;
    codeChallenge: string;
    ressource: string;
  }): string {
    const code = PREFIXE_CODE + randomBytes(32).toString('base64url');
    this.base
      .prepare(
        `INSERT INTO oauth_codes
           (empreinte, client_id, utilisateur_id, redirect_uri, code_challenge, portee, ressource, expire_le, cree_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        empreinteJeton(code),
        entree.clientId,
        entree.utilisateurId,
        entree.redirectUri,
        entree.codeChallenge,
        PORTEE_DOSSIERS,
        entree.ressource,
        new Date(Date.now() + DUREE_CODE * 1000).toISOString(),
        new Date().toISOString(),
      );
    return code;
  }

  /**
   * Consomme un code et rend le compte auquel il donne accès.
   *
   * Toutes les vérifications de la spécification sont faites ici, dans l'ordre où
   * elles comptent : existence, usage unique, expiration, appartenance au client,
   * concordance de l'adresse de redirection, puis PKCE.
   */
  consommerCode(entree: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): { utilisateurId: string; ressource: string } {
    const empreinte = empreinteJeton(entree.code);
    const ligne = this.base
      .prepare('SELECT * FROM oauth_codes WHERE empreinte = ?')
      .get(empreinte) as
      | {
          client_id: string;
          utilisateur_id: string;
          redirect_uri: string;
          code_challenge: string;
          ressource: string;
          expire_le: string;
          consomme_le: string | null;
        }
      | undefined;

    if (!ligne) throw new ErreurOauth('invalid_grant', 'Code d’autorisation inconnu.');

    if (ligne.consomme_le) {
      // Un code rejoué signale une interception : tout ce qui a été émis pour ce
      // compte et ce client est révoqué, plutôt que d'attendre l'expiration.
      this.revoquerPourClient(ligne.utilisateur_id, ligne.client_id);
      throw new ErreurOauth('invalid_grant', 'Code d’autorisation déjà utilisé.');
    }
    if (ligne.expire_le <= new Date().toISOString()) {
      throw new ErreurOauth('invalid_grant', 'Code d’autorisation expiré.');
    }
    if (ligne.client_id !== entree.clientId) {
      throw new ErreurOauth('invalid_grant', 'Ce code n’a pas été émis pour ce client.');
    }
    if (ligne.redirect_uri !== entree.redirectUri) {
      throw new ErreurOauth('invalid_grant', 'L’adresse de redirection ne correspond pas à celle du code.');
    }

    // PKCE : l'empreinte du vérificateur doit reproduire le défi. La comparaison est
    // en temps constant, le défi étant une valeur secrète du point de vue du serveur.
    const calcule = createHash('sha256').update(entree.codeVerifier).digest('base64url');
    const attendu = Buffer.from(ligne.code_challenge);
    const obtenu = Buffer.from(calcule);
    if (attendu.length !== obtenu.length || !timingSafeEqual(attendu, obtenu)) {
      throw new ErreurOauth('invalid_grant', 'Le vérificateur PKCE ne correspond pas au défi.');
    }

    this.base
      .prepare('UPDATE oauth_codes SET consomme_le = ? WHERE empreinte = ?')
      .run(new Date().toISOString(), empreinte);

    return { utilisateurId: ligne.utilisateur_id, ressource: ligne.ressource };
  }

  // ─── Jetons ─────────────────────────────────────────────────────────────────

  emettreJetons(entree: {
    clientId: string;
    utilisateurId: string;
    ressource: string;
  }): { acces: string; rafraichissement: string } {
    const acces = PREFIXE_ACCES + randomBytes(32).toString('base64url');
    const rafraichissement = PREFIXE_RAFRAICHISSEMENT + randomBytes(32).toString('base64url');
    const maintenant = new Date();

    const poser = this.base.prepare(
      `INSERT INTO oauth_jetons
         (empreinte, genre, client_id, utilisateur_id, portee, ressource, expire_le, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    poser.run(
      empreinteJeton(acces),
      'acces',
      entree.clientId,
      entree.utilisateurId,
      PORTEE_DOSSIERS,
      entree.ressource,
      new Date(maintenant.getTime() + DUREE_ACCES * 1000).toISOString(),
      maintenant.toISOString(),
    );
    poser.run(
      empreinteJeton(rafraichissement),
      'rafraichissement',
      entree.clientId,
      entree.utilisateurId,
      PORTEE_DOSSIERS,
      entree.ressource,
      new Date(maintenant.getTime() + DUREE_RAFRAICHISSEMENT * 1000).toISOString(),
      maintenant.toISOString(),
    );

    this.base
      .prepare('UPDATE oauth_clients SET derniere_utilisation = ? WHERE client_id = ?')
      .run(maintenant.toISOString(), entree.clientId);

    return { acces, rafraichissement };
  }

  /**
   * Échange un jeton de rafraîchissement contre un couple neuf.
   *
   * Rotation systématique : l'ancien est révoqué. Le rejeu d'un jeton déjà échangé
   * révoque toute la lignée du compte pour ce client — c'est la seule façon de
   * répondre à une fuite qu'on ne peut pas constater autrement.
   */
  rafraichir(entree: { jeton: string; clientId: string }): {
    utilisateurId: string;
    ressource: string;
    acces: string;
    rafraichissement: string;
  } {
    const empreinte = empreinteJeton(entree.jeton);
    const ligne = this.base
      .prepare("SELECT * FROM oauth_jetons WHERE empreinte = ? AND genre = 'rafraichissement'")
      .get(empreinte) as
      | {
          client_id: string;
          utilisateur_id: string;
          ressource: string;
          expire_le: string;
          revoque_le: string | null;
        }
      | undefined;

    if (!ligne) throw new ErreurOauth('invalid_grant', 'Jeton de rafraîchissement inconnu.');
    if (ligne.revoque_le) {
      this.revoquerPourClient(ligne.utilisateur_id, ligne.client_id);
      throw new ErreurOauth(
        'invalid_grant',
        'Jeton de rafraîchissement déjà échangé. Tous les jetons de ce client ont été révoqués.',
      );
    }
    if (ligne.expire_le <= new Date().toISOString()) {
      throw new ErreurOauth('invalid_grant', 'Jeton de rafraîchissement expiré.');
    }
    if (ligne.client_id !== entree.clientId) {
      throw new ErreurOauth('invalid_grant', 'Ce jeton n’a pas été émis pour ce client.');
    }

    const maintenant = new Date().toISOString();
    this.base
      .prepare('UPDATE oauth_jetons SET revoque_le = ? WHERE empreinte = ?')
      .run(maintenant, empreinte);

    const emis = this.emettreJetons({
      clientId: ligne.client_id,
      utilisateurId: ligne.utilisateur_id,
      ressource: ligne.ressource,
    });
    this.base
      .prepare('UPDATE oauth_jetons SET remplace = ? WHERE empreinte = ?')
      .run(empreinte, empreinteJeton(emis.rafraichissement));

    return {
      utilisateurId: ligne.utilisateur_id,
      ressource: ligne.ressource,
      acces: emis.acces,
      rafraichissement: emis.rafraichissement,
    };
  }

  /** Résout un jeton d'accès et rend le compte, ou null. */
  parJetonAcces(jeton: string): Utilisateur | null {
    if (!jeton.startsWith(PREFIXE_ACCES)) return null;
    const ligne = this.base
      .prepare(
        `SELECT u.* FROM oauth_jetons j
         JOIN utilisateurs u ON u.id = j.utilisateur_id
         WHERE j.empreinte = ? AND j.genre = 'acces' AND j.revoque_le IS NULL
           AND j.expire_le > ? AND u.actif = 1`,
      )
      .get(empreinteJeton(jeton), new Date().toISOString()) as
      | {
          id: string;
          email: string;
          nom: string;
          role: string;
          cree_le: string;
          derniere_connexion: string | null;
          actif: number;
        }
      | undefined;
    if (!ligne) return null;
    return {
      id: ligne.id,
      email: ligne.email,
      nom: ligne.nom,
      role: ligne.role as Utilisateur['role'],
      creeLe: ligne.cree_le,
      derniereConnexion: ligne.derniere_connexion,
      actif: true,
    };
  }

  /** Révoque un jeton isolé, quel que soit son genre. */
  revoquer(jeton: string): boolean {
    return (
      this.base
        .prepare('UPDATE oauth_jetons SET revoque_le = ? WHERE empreinte = ? AND revoque_le IS NULL')
        .run(new Date().toISOString(), empreinteJeton(jeton)).changes > 0
    );
  }

  /**
   * Révoque tout ce qui a été émis à un compte, pour tous les clients.
   *
   * C'est ce que doit faire un changement de mot de passe : un connecteur autorisé
   * garde sinon trente jours d'accès aux dossiers, accordé avec le mot de passe qu'on
   * vient justement de changer.
   */
  revoquerPourUtilisateur(utilisateurId: string): number {
    const maintenant = new Date().toISOString();

    // Les codes en attente comptent autant que les jetons. Un code émis mais pas encore
    // échangé vaut un couple de jetons neuf pour trente jours : le laisser vivre
    // laisserait l'accès rouvrir juste après la révocation.
    this.base
      .prepare(
        `UPDATE oauth_codes SET consomme_le = ?
         WHERE utilisateur_id = ? AND consomme_le IS NULL`,
      )
      .run(maintenant, utilisateurId);

    return this.base
      .prepare(
        `UPDATE oauth_jetons SET revoque_le = ?
         WHERE utilisateur_id = ? AND revoque_le IS NULL`,
      )
      .run(maintenant, utilisateurId).changes;
  }

  /**
   * Révoque tout ce qui a été émis à un compte pour un client donné.
   *
   * Les codes en attente comptent autant que les jetons, exactement comme dans
   * `revoquerPourUtilisateur`. Un code accordé mais pas encore échangé vaut un couple de
   * jetons neuf pour trente jours, et il vit dix minutes : la révocation depuis l'écran
   * Administration laissait donc l'accès se rouvrir dans les dix minutes qui la suivaient
   * — précisément la minute où l'on révoque un consentement accordé par erreur.
   *
   * Marquer le code « consommé » ne distingue pas la révocation d'une vraie consommation :
   * s'il est présenté ensuite, il est traité en rejeu, et la lignée déjà révoquée l'est une
   * seconde fois. C'est le côté prudent de l'erreur, et c'est la convention du fichier.
   */
  revoquerPourClient(utilisateurId: string, clientId: string): number {
    const maintenant = new Date().toISOString();

    const codes = this.base
      .prepare(
        `UPDATE oauth_codes SET consomme_le = ?
         WHERE utilisateur_id = ? AND client_id = ? AND consomme_le IS NULL`,
      )
      .run(maintenant, utilisateurId, clientId).changes;

    const jetons = this.base
      .prepare(
        `UPDATE oauth_jetons SET revoque_le = ?
         WHERE utilisateur_id = ? AND client_id = ? AND revoque_le IS NULL`,
      )
      .run(maintenant, utilisateurId, clientId).changes;

    return codes + jetons;
  }

  /**
   * Toutes les autorisations en cours, pour l'écran Administration.
   *
   * Une ligne par couple compte-client : c'est l'unité qu'on révoque. La date retenue
   * est celle du premier jeton encore valable, soit le moment du consentement ou du
   * dernier rafraîchissement.
   *
   * Les codes non encore échangés y figurent aussi, et c'est là l'essentiel : un
   * consentement venait d'être accordé, aucun jeton n'existait encore, et la ligne
   * n'apparaissait donc nulle part. L'expert-comptable qui venait d'approuver un
   * connecteur par erreur ouvrait cet écran, n'y voyait rien à révoquer, et le connecteur
   * échangeait son code dans les dix minutes — trente jours d'accès aux dossiers réels.
   * Le consentement est maintenant visible dès l'instant où il est donné.
   */
  listerToutes(): AutorisationOauth[] {
    const maintenant = new Date().toISOString();
    return this.base
      .prepare(
        `SELECT g.utilisateur_id, u.nom AS compte, u.email AS courriel, g.client_id,
                c.nom AS nom_client, MIN(g.cree_le) AS accordee_le, MAX(g.expire_le) AS expire_le,
                MAX(g.en_attente) AS en_attente
         FROM (${ACCES_EN_COURS}) g
         JOIN utilisateurs u ON u.id = g.utilisateur_id
         LEFT JOIN oauth_clients c ON c.client_id = g.client_id
         GROUP BY g.utilisateur_id, g.client_id
         ORDER BY accordee_le DESC`,
      )
      .all(maintenant, maintenant)
      .map((l) => {
        const r = l as {
          utilisateur_id: string;
          compte: string;
          courriel: string;
          client_id: string;
          nom_client: string | null;
          accordee_le: string;
          expire_le: string;
          en_attente: number;
        };
        return {
          utilisateurId: r.utilisateur_id,
          compte: r.compte,
          courriel: r.courriel,
          clientId: r.client_id,
          nomClient: r.nom_client ?? '',
          accordeeLe: r.accordee_le,
          expireLe: r.expire_le,
          enAttente: r.en_attente === 1,
        };
      });
  }
}

/**
 * Ce qui vaut accès à un dossier : un jeton en cours, ou un code pas encore échangé.
 *
 * Les deux tables sont réunies plutôt que consultées l'une après l'autre, pour que
 * l'écran Administration ne puisse pas montrer une moitié de la vérité. Le drapeau
 * « en_attente » distingue le consentement dont le jeton reste à venir.
 */
const ACCES_EN_COURS = `
  SELECT utilisateur_id, client_id, cree_le, expire_le, 0 AS en_attente
    FROM oauth_jetons WHERE revoque_le IS NULL AND expire_le > ?
  UNION ALL
  SELECT utilisateur_id, client_id, cree_le, expire_le, 1 AS en_attente
    FROM oauth_codes WHERE consomme_le IS NULL AND expire_le > ?
`;

/** Erreur portant un code d'erreur OAuth, restitué tel quel au client. */
export class ErreurOauth extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurOauth';
  }
}

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import {
  CLES_PAR_COMPTE,
  DUREE_DEFI,
  TRANSPORTS_CONNUS,
  zReponseAssertion,
  zReponseEnregistrement,
  type CeremonieCle,
  type CleAcces,
  type Utilisateur,
} from '@previs/core';
import type { z } from 'zod';
import type { BaseDonnees } from './base.js';
import { nouvelIdentifiant } from './securite.js';

/**
 * Clés d'accès (WebAuthn) : enregistrement, connexion, gestion.
 *
 * Quatre points portent toute la sûreté du procédé, et aucun n'est facultatif :
 *
 * 1. **Le défi vient du serveur et n'y revient jamais.** Il est conservé ici, le client
 *    ne reçoit qu'un identifiant opaque, et il est consommé en une seule écriture
 *    conditionnelle — sinon deux requêtes concurrentes s'en serviraient toutes deux.
 * 2. **L'origine et l'identifiant de partie de confiance viennent de `PUBLIC_URL`**,
 *    jamais de l'en-tête `Host`, que n'importe quel client peut forger. C'est ce qui
 *    fait qu'une signature obtenue sur le site d'un attaquant ne vaut rien ici — la
 *    résistance à l'hameçonnage, seule raison d'ajouter des clés d'accès.
 * 3. **La vérification du porteur est exigée.** Une clé d'accès remplace le mot de
 *    passe : sans code ni biométrie, un appareil ramassé ouvrirait le compte.
 * 4. **Le compteur est confié à la bibliothèque.** Elle refuse une régression, et saute
 *    le contrôle quand il vaut zéro de part et d'autre : une clé synchronisée — trousseau
 *    iCloud, gestionnaire de mots de passe — rapporte zéro à vie. Un contrôle maison
 *    exigeant une progression stricte casserait la majorité des clés d'accès.
 */

/** Genres de cérémonie. Un défi émis pour l'une ne vaut pas pour l'autre. */
type Genre = 'enregistrement' | 'connexion';

type ReponseEnregistrement = z.infer<typeof zReponseEnregistrement>;
type ReponseAssertion = z.infer<typeof zReponseAssertion>;

interface LigneCle {
  id: string;
  utilisateur_id: string;
  identifiant_cle: string;
  cle_publique: string;
  compteur: number;
  transports: string;
  libelle: string;
  synchronisee: number;
  cree_le: string;
  derniere_utilisation: string | null;
}

/**
 * Erreur portant un motif restituable au client, sans détail exploitable.
 *
 * Le statut 401 y signifie toujours « l'identifiant présenté a été refusé », jamais
 * « votre session a expiré » : la route le traduit dans le code d'erreur du contrat, et
 * l'interface s'en sert pour décider si elle affiche le message ou renvoie à la connexion.
 */
export class ErreurCle extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurCle';
  }
}

/**
 * Origines acceptées et identifiant de partie de confiance, déduits de l'adresse
 * publique.
 *
 * L'en-tête `Host` est recopié tel quel par le frontal : un identifiant de partie de
 * confiance qui en dériverait laisserait l'attaquant choisir pour quel domaine la
 * signature vaut. `PUBLIC_URL` est la seule source acceptable.
 *
 * Sur la boucle locale — et là seulement — les ports du serveur de développement sont
 * ajoutés : l'interface y tourne sur 5173 tandis que l'API répond sur un autre port. En
 * production le nom d'hôte n'est pas une boucle locale, rien n'est ajouté.
 */
export function partieDeConfiance(urlPublique: string): {
  rpID: string;
  origines: string[];
  actives: boolean;
  motif: string;
} {
  let url: URL;
  try {
    url = new URL(urlPublique);
  } catch {
    return {
      rpID: '',
      origines: [],
      actives: false,
      motif: `L’adresse publique « ${urlPublique} » est illisible.`,
    };
  }

  const boucleLocale =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const origines = [url.origin];
  if (boucleLocale) {
    for (const port of [5173, 4173]) {
      for (const hote of ['localhost', '127.0.0.1']) origines.push(`http://${hote}:${port}`);
    }
  }

  // Un identifiant de partie de confiance est un nom de domaine : un navigateur refuse
  // une adresse numérique, et prétendre le contraire ferait échouer la cérémonie côté
  // client avec un message que personne ne saurait relier à la configuration.
  const numerique = /^\[?[0-9a-fA-F:.]+\]?$/.test(url.hostname) && !boucleLocale;

  // Un navigateur refuse aussi WebAuthn hors contexte sûr.
  const enClair = url.protocol !== 'https:' && !boucleLocale;
  const actives = !enClair && !numerique;

  let motif = '';
  if (enClair) {
    motif = `Les clés d’accès exigent une adresse publique en https. PUBLIC_URL vaut « ${urlPublique} ».`;
  } else if (numerique) {
    motif = `Les clés d’accès exigent un nom de domaine, non une adresse numérique. PUBLIC_URL vaut « ${urlPublique} ».`;
  }

  return { rpID: url.hostname, origines: [...new Set(origines)], actives, motif };
}

/**
 * Reconstruit la réponse attendue par la bibliothèque, champ par champ.
 *
 * Le schéma zod a déjà borné chaque valeur ; cette fonction ne fait que rebâtir l'objet
 * dans la forme exacte du type, sans conversion forcée. Recopier l'objet du client tel
 * quel y laisserait passer les champs qu'il aurait ajoutés.
 */
export function versReponseEnregistrement(brut: ReponseEnregistrement): RegistrationResponseJSON {
  return {
    id: brut.id,
    rawId: brut.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: brut.response.clientDataJSON,
      attestationObject: brut.response.attestationObject,
      transports: transportsConnus(brut.response.transports),
    },
  };
}

export function versReponseAssertion(brut: ReponseAssertion): AuthenticationResponseJSON {
  return {
    id: brut.id,
    rawId: brut.rawId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: brut.response.clientDataJSON,
      authenticatorData: brut.response.authenticatorData,
      signature: brut.response.signature,
      userHandle: brut.response.userHandle,
    },
  };
}

/** Ne retient que les transports que la spécification connaît. */
function transportsConnus(annonces: string[] | undefined): AuthenticatorTransportFuture[] {
  if (!annonces) return [];
  return annonces.filter((t): t is AuthenticatorTransportFuture =>
    (TRANSPORTS_CONNUS as readonly string[]).includes(t),
  );
}

/** Copie sur un tampon propre : les aides de la bibliothèque n'acceptent pas autre chose. */
function octets(source: Uint8Array | Buffer): Uint8Array<ArrayBuffer> {
  const copie = new Uint8Array(new ArrayBuffer(source.length));
  copie.set(source);
  return copie;
}

export class ServiceClesAcces {
  private readonly rpID: string;
  private readonly origines: string[];
  readonly actives: boolean;
  readonly motifIndisponible: string;

  constructor(
    private readonly base: BaseDonnees,
    urlPublique: string,
    /** Nom affiché par le système au moment du geste : celui du cabinet, tel qu'il est. */
    private readonly nomAffiche: () => string,
  ) {
    const { rpID, origines, actives, motif } = partieDeConfiance(urlPublique);
    this.rpID = rpID;
    this.origines = origines;
    this.actives = actives;
    this.motifIndisponible = motif;
  }

  /** Refuse tout net quand le déploiement ne permet pas WebAuthn. */
  private exigerActives(): void {
    if (!this.actives) throw new ErreurCle(503, this.motifIndisponible);
  }

  // ─── Consultation ───────────────────────────────────────────────────────────

  lister(utilisateurId: string): CleAcces[] {
    return this.base
      .prepare(
        `SELECT id, libelle, synchronisee, cree_le, derniere_utilisation
         FROM cles_acces WHERE utilisateur_id = ? ORDER BY cree_le`,
      )
      .all(utilisateurId)
      .map((l) => {
        const r = l as Pick<
          LigneCle,
          'id' | 'libelle' | 'synchronisee' | 'cree_le' | 'derniere_utilisation'
        >;
        return {
          id: r.id,
          libelle: r.libelle,
          creeLe: r.cree_le,
          derniereUtilisation: r.derniere_utilisation,
          synchronisee: r.synchronisee === 1,
        };
      });
  }

  /** Nombre de clés d'un compte, pour savoir s'il peut encore se connecter sans. */
  compter(utilisateurId: string): number {
    return (
      this.base
        .prepare('SELECT COUNT(*) AS n FROM cles_acces WHERE utilisateur_id = ?')
        .get(utilisateurId) as { n: number }
    ).n;
  }

  // ─── Défis ──────────────────────────────────────────────────────────────────

  private deposerDefi(entree: { defi: string; genre: Genre; utilisateurId: string | null }): string {
    // Purge opportuniste : le point d'entrée de connexion est public, et cette ligne
    // borne la table sans attendre le passage périodique.
    this.base.prepare('DELETE FROM webauthn_defis WHERE expire_le < ?').run(new Date().toISOString());

    const id = nouvelIdentifiant('def');
    this.base
      .prepare(
        `INSERT INTO webauthn_defis (id, defi, genre, utilisateur_id, expire_le, cree_le)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entree.defi,
        entree.genre,
        entree.utilisateurId,
        new Date(Date.now() + DUREE_DEFI * 1000).toISOString(),
        new Date().toISOString(),
      );
    return id;
  }

  /**
   * Consomme un défi : il est lu et supprimé par une seule instruction.
   *
   * Lire, vérifier, puis supprimer laisserait deux requêtes concurrentes franchir le
   * même défi — la vérification étant asynchrone, la fenêtre est réelle. `RETURNING`
   * rend la lecture et la suppression indivisibles.
   */
  private consommerDefi(id: string, genre: Genre): { defi: string; utilisateurId: string | null } {
    const ligne = this.base
      .prepare(
        `DELETE FROM webauthn_defis WHERE id = ? AND genre = ? AND expire_le > ?
         RETURNING defi, utilisateur_id`,
      )
      .get(id, genre, new Date().toISOString()) as
      | { defi: string; utilisateur_id: string | null }
      | undefined;
    if (!ligne) {
      throw new ErreurCle(400, 'Cette demande a expiré. Recommencer depuis le début.');
    }
    return { defi: ligne.defi, utilisateurId: ligne.utilisateur_id };
  }

  // ─── Enregistrement ─────────────────────────────────────────────────────────

  async debuterEnregistrement(utilisateur: Utilisateur): Promise<CeremonieCle> {
    this.exigerActives();
    if (this.compter(utilisateur.id) >= CLES_PAR_COMPTE) {
      throw new ErreurCle(
        409,
        `Ce compte a déjà ${CLES_PAR_COMPTE} clés enregistrées. En retirer une avant d’en ajouter.`,
      );
    }

    const existantes = this.base
      .prepare('SELECT identifiant_cle, transports FROM cles_acces WHERE utilisateur_id = ?')
      .all(utilisateur.id) as Array<{ identifiant_cle: string; transports: string }>;

    const options = await generateRegistrationOptions({
      rpName: this.nomAffiche(),
      rpID: this.rpID,
      // L'identifiant interne, jamais l'adresse électronique : une clé rattachée à une
      // adresse donnerait accès au compte recréé d'un collaborateur parti.
      userID: octets(Buffer.from(utilisateur.id, 'utf8')),
      userName: utilisateur.email,
      userDisplayName: utilisateur.nom,
      timeout: DUREE_DEFI * 1000,
      attestationType: 'none',
      // Une clé déjà enregistrée ne doit pas l'être deux fois : l'authentificateur le
      // dira lui-même plutôt que de créer un doublon inutilisable.
      excludeCredentials: existantes.map((c) => ({
        id: c.identifiant_cle,
        transports: c.transports ? (c.transports.split(',') as never) : undefined,
      })),
      authenticatorSelection: {
        // Clé découvrable : c'est ce qui permet de se connecter sans saisir d'adresse.
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    return {
      demande: this.deposerDefi({
        defi: options.challenge,
        genre: 'enregistrement',
        utilisateurId: utilisateur.id,
      }),
      options: options as unknown as Record<string, unknown>,
    };
  }

  async acheverEnregistrement(entree: {
    demande: string;
    utilisateurId: string;
    libelle: string;
    reponse: ReponseEnregistrement;
  }): Promise<CleAcces> {
    this.exigerActives();
    const { defi, utilisateurId } = this.consommerDefi(entree.demande, 'enregistrement');

    // Le défi porte le compte qui l'a demandé : un défi obtenu par un compte ne doit
    // pas servir à poser une clé sur un autre.
    if (utilisateurId !== entree.utilisateurId) {
      throw new ErreurCle(400, 'Cette demande n’a pas été ouverte par ce compte.');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: versReponseEnregistrement(entree.reponse),
        expectedChallenge: defi,
        expectedOrigin: this.origines,
        // Facultatif ici alors qu'il est obligatoire à la connexion : l'omettre
        // désactiverait silencieusement le contrôle de l'empreinte du domaine.
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch {
      // Le message de la bibliothèque n'est pas restitué : selon le contrôle qui a
      // échoué, il recopie le défi. Un jeton en clair n'a rien à faire dans une réponse
      // ni dans un journal.
      throw new ErreurCle(400, 'Cette clé d’accès n’a pas pu être vérifiée.');
    }
    if (!verification.verified) {
      throw new ErreurCle(400, 'Cette clé d’accès n’a pas pu être vérifiée.');
    }

    const { credential, credentialBackedUp } = verification.registrationInfo;

    // Le plafond est contrôlé une seconde fois, ici : le premier contrôle a eu lieu à
    // l'ouverture de la cérémonie, et rien n'empêche d'en ouvrir dix avant d'en achever
    // aucune.
    if (this.compter(entree.utilisateurId) >= CLES_PAR_COMPTE) {
      throw new ErreurCle(
        409,
        `Ce compte a déjà ${CLES_PAR_COMPTE} clés enregistrées. En retirer une avant d’en ajouter.`,
      );
    }

    const id = nouvelIdentifiant('cle');
    try {
      this.base
        .prepare(
          `INSERT INTO cles_acces
             (id, utilisateur_id, identifiant_cle, cle_publique, compteur, transports,
              libelle, synchronisee, cree_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          entree.utilisateurId,
          credential.id,
          isoBase64URL.fromBuffer(credential.publicKey),
          credential.counter,
          (credential.transports ?? []).join(','),
          entree.libelle.trim() || 'Clé d’accès',
          credentialBackedUp ? 1 : 0,
          new Date().toISOString(),
        );
    } catch (e) {
      // La contrainte d'unicité est ce qui empêche un compte de déclarer l'identifiant
      // de justificatif d'un collègue, l'attestation n'étant pas demandée.
      if (String((e as Error).message).includes('UNIQUE')) {
        throw new ErreurCle(409, 'Cette clé est déjà enregistrée.');
      }
      throw e;
    }

    return {
      id,
      libelle: entree.libelle.trim() || 'Clé d’accès',
      creeLe: new Date().toISOString(),
      derniereUtilisation: null,
      synchronisee: credentialBackedUp,
    };
  }

  // ─── Connexion ──────────────────────────────────────────────────────────────

  /**
   * Ouvre une cérémonie de connexion.
   *
   * Aucune adresse électronique n'est demandée et aucune liste de clés n'est renvoyée :
   * ce point d'entrée est public, et composer la liste des clés d'une adresse en ferait
   * l'oracle d'énumération que la connexion par mot de passe évite soigneusement.
   */
  async debuterConnexion(): Promise<CeremonieCle> {
    this.exigerActives();
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      timeout: DUREE_DEFI * 1000,
    });
    return {
      demande: this.deposerDefi({ defi: options.challenge, genre: 'connexion', utilisateurId: null }),
      options: options as unknown as Record<string, unknown>,
    };
  }

  /**
   * Achève une connexion et rend le compte reconnu.
   *
   * Un seul message d'échec, quel que soit le motif : distinguer « clé inconnue » de
   * « signature invalide » ou de « compte désactivé » dirait à qui essaie ce qu'il a
   * touché.
   */
  async acheverConnexion(entree: {
    demande: string;
    reponse: ReponseAssertion;
  }): Promise<{ utilisateurId: string; cleId: string; libelle: string }> {
    this.exigerActives();
    const { defi } = this.consommerDefi(entree.demande, 'connexion');
    const refus = new ErreurCle(401, 'Cette clé d’accès n’a pas été reconnue.');

    const identifiant = entree.reponse.id;
    if (typeof identifiant !== 'string' || !identifiant) throw refus;

    // Le rapprochement par l'identifiant du justificatif est à notre charge : la
    // bibliothèque ne compare pas la réponse à la clé qu'on lui passe.
    const ligne = this.base
      .prepare(
        `SELECT c.* FROM cles_acces c
         JOIN utilisateurs u ON u.id = c.utilisateur_id
         WHERE c.identifiant_cle = ? AND u.actif = 1`,
      )
      .get(identifiant) as LigneCle | undefined;
    if (!ligne) throw refus;

    // Le porteur annoncé par l'authentificateur doit être celui que porte la clé. Il
    // n'est pas digne de confiance en lui-même — c'est le client qui l'envoie — mais une
    // discordance signale un justificatif qui ne va pas avec le compte trouvé. Les clés
    // sont enregistrées comme découvrables : la spécification veut qu'une telle clé
    // rapporte son porteur, il est donc exigé.
    const porteur = entree.reponse.response.userHandle;
    if (!porteur) throw refus;
    let annonce = '';
    try {
      annonce = Buffer.from(isoBase64URL.toBuffer(porteur)).toString('utf8');
    } catch {
      throw refus;
    }
    if (annonce !== ligne.utilisateur_id) throw refus;

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: versReponseAssertion(entree.reponse),
        expectedChallenge: defi,
        expectedOrigin: this.origines,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: ligne.identifiant_cle,
          publicKey: octets(isoBase64URL.toBuffer(ligne.cle_publique)),
          counter: ligne.compteur,
        },
      });
    } catch {
      // Une régression du compteur lève, elle ne rend pas « non vérifié » : sans ce
      // filet, un authentificateur cloné produirait un 500 au lieu d'un refus.
      throw refus;
    }
    // `authenticationInfo` est renseigné même quand la vérification échoue : sans ce
    // contrôle explicite, on enregistrerait le compteur d'une assertion refusée.
    if (!verification.verified) throw refus;

    this.base
      .prepare('UPDATE cles_acces SET compteur = ?, derniere_utilisation = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, new Date().toISOString(), ligne.id);

    return { utilisateurId: ligne.utilisateur_id, cleId: ligne.id, libelle: ligne.libelle };
  }

  // ─── Suppression ────────────────────────────────────────────────────────────

  /**
   * Retire une clé du compte qui la porte.
   *
   * Le compte fait partie de la condition : sans lui, n'importe quel compte — un lecteur
   * compris — retirerait la clé d'un autre.
   */
  supprimer(utilisateurId: string, id: string): { libelle: string; sessionsFermees: number } | null {
    const ligne = this.base
      .prepare('DELETE FROM cles_acces WHERE id = ? AND utilisateur_id = ? RETURNING libelle')
      .get(id, utilisateurId) as { libelle: string } | undefined;
    if (!ligne) return null;

    // On retire une clé parce que l'appareil qui la portait est perdu ou n'est plus de
    // confiance. Cet appareil garde pourtant sa session ouverte trente jours : retirer la
    // clé sans fermer les sessions ne fermerait rien du tout. Elles ne sont pas
    // rattachées à un appareil, on ferme donc les siennes toutes.
    const sessionsFermees = this.base
      .prepare('DELETE FROM sessions WHERE utilisateur_id = ?')
      .run(utilisateurId).changes;

    return { libelle: ligne.libelle, sessionsFermees };
  }
}

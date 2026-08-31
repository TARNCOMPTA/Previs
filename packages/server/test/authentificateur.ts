import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Authentificateur factice, pour éprouver les cérémonies WebAuthn sans navigateur.
 *
 * Les essais du serveur passent par `app.inject()` : aucun navigateur, donc aucun vrai
 * authentificateur. Cette classe en tient le rôle — elle porte une paire de clés
 * ECDSA P-256 et fabrique les réponses exactement comme le ferait un téléphone ou une
 * clé matérielle : mêmes structures, même signature.
 *
 * Elle sait aussi mal se comporter, à la demande : signer avec une autre clé, omettre
 * la vérification de l'utilisateur, faire régresser son compteur, prétendre venir d'une
 * autre origine. C'est à cela qu'elle sert le plus — un contrôle qu'on ne peut pas
 * mettre en défaut n'est pas éprouvé.
 */

/**
 * Copie en tableau d'octets adossé à son propre tampon.
 *
 * Deux raisons, pas une : un Buffer issu du bassin de Node porte un décalage dans un
 * tampon partagé, et son type `Uint8Array<ArrayBufferLike>` n'est pas assignable à ce
 * qu'attendent les aides de la bibliothèque. La copie règle les deux d'un coup.
 */
function octets(source: Uint8Array | Buffer): Octets {
  const copie = new Uint8Array(new ArrayBuffer(source.length));
  copie.set(source);
  return copie;
}

/** Ce que la bibliothèque nomme `Uint8Array_` : un tableau sur un tampon non partagé. */
type Octets = Uint8Array<ArrayBuffer>;

/** Drapeaux du champ `flags` des données d'authentificateur. */
const PRESENCE = 0x01;
const VERIFICATION = 0x04;
const DONNEES_CLE = 0x40;

export class AuthentificateurFactice {
  private readonly clePrivee: KeyObject;
  private readonly clePubliqueCose: Octets;
  /** Identifiant de la clé, en base64url — c'est sous cette forme qu'il circule. */
  readonly identifiant: string;
  private readonly identifiantOctets: Octets;
  compteur = 0;
  /**
   * Identifiant du compte que la clé rapporte, comme le fait une clé découvrable.
   *
   * Une valeur par défaut non vide, car une réponse sans porteur est refusée à la
   * frontière : un essai qui veut éprouver le refus d'une clé inconnue doit tout de
   * même produire une réponse bien formée.
   */
  porteur: string;

  constructor(graine = 1) {
    this.porteur = `utl-inconnu-${graine}`;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.clePrivee = privateKey;

    // La clé publique voyage en COSE_Key : les coordonnées du point, pas un format PEM.
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.clePubliqueCose = isoCBOR.encode(
      new Map<number, number | Octets>([
        [1, 2], // kty : EC2
        [3, -7], // alg : ES256
        [-1, 1], // crv : P-256
        [-2, octets(Buffer.from(jwk.x, 'base64url'))],
        [-3, octets(Buffer.from(jwk.y, 'base64url'))],
      ]),
    );

    // Un identifiant de clé n'est pas secret, mais il doit être unique : la graine
    // distingue deux authentificateurs dans un même essai.
    this.identifiantOctets = octets(
      createHash('sha256').update(`cle-factice-${graine}-${jwk.x}`).digest().subarray(0, 32),
    );
    this.identifiant = isoBase64URL.fromBuffer(this.identifiantOctets);
  }

  /**
   * Données d'authentificateur : empreinte de l'identifiant de partie de confiance,
   * drapeaux, compteur, et pour un enregistrement les données de la clé créée.
   */
  private donnees(entree: {
    rpId: string;
    compteur: number;
    verifie: boolean;
    present?: boolean;
    avecCle?: boolean;
  }): Octets {
    const empreinteRp = createHash('sha256').update(entree.rpId).digest();
    let drapeaux = 0;
    if (entree.present !== false) drapeaux |= PRESENCE;
    if (entree.verifie) drapeaux |= VERIFICATION;
    if (entree.avecCle) drapeaux |= DONNEES_CLE;

    const compteur = Buffer.alloc(4);
    compteur.writeUInt32BE(entree.compteur);

    const morceaux: Buffer[] = [empreinteRp, Buffer.from([drapeaux]), compteur];
    if (entree.avecCle) {
      const longueur = Buffer.alloc(2);
      longueur.writeUInt16BE(this.identifiantOctets.length);
      morceaux.push(
        Buffer.alloc(16), // aaguid : nul, l'attestation n'est pas demandée
        longueur,
        Buffer.from(this.identifiantOctets),
        Buffer.from(this.clePubliqueCose),
      );
    }
    return octets(Buffer.concat(morceaux));
  }

  private donneesClient(entree: { type: string; defi: string; origine: string }): Octets {
    return octets(
      Buffer.from(
        JSON.stringify({
          type: entree.type,
          challenge: entree.defi,
          origin: entree.origine,
          crossOrigin: false,
        }),
        'utf8',
      ),
    );
  }

  /** Réponse d'enregistrement, telle que `startRegistration()` la rendrait. */
  enregistrer(entree: {
    defi: string;
    origine: string;
    rpId: string;
    /** Faux pour éprouver le refus d'une clé enregistrée sans vérification du porteur. */
    verifie?: boolean;
    type?: string;
  }): RegistrationResponseJSON {
    const donneesAuth = this.donnees({
      rpId: entree.rpId,
      compteur: this.compteur,
      verifie: entree.verifie !== false,
      avecCle: true,
    });
    const attestation = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', donneesAuth],
      ]) as never,
    );

    return {
      id: this.identifiant,
      rawId: this.identifiant,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(
          this.donneesClient({
            type: entree.type ?? 'webauthn.create',
            defi: entree.defi,
            origine: entree.origine,
          }),
        ),
        attestationObject: isoBase64URL.fromBuffer(attestation),
        transports: ['internal'],
      },
    };
  }

  /** Réponse d'authentification, telle que `startAuthentication()` la rendrait. */
  authentifier(entree: {
    defi: string;
    origine: string;
    rpId: string;
    verifie?: boolean;
    /** Compteur imposé : c'est ainsi qu'on simule un authentificateur cloné. */
    compteur?: number;
    /** Signer avec la clé d'un autre : la signature doit alors être refusée. */
    signeAvec?: AuthentificateurFactice;
    identifiant?: string;
    type?: string;
    /**
     * Le porteur annoncé. Une clé découvrable rapporte l'identifiant du compte ; le
     * fausser ou l'omettre doit faire refuser la connexion.
     */
    porteur?: string;
    sansPorteur?: boolean;
  }): AuthenticationResponseJSON {
    const compteur = entree.compteur ?? this.compteur + 1;
    this.compteur = Math.max(this.compteur, compteur);

    const donneesAuth = this.donnees({
      rpId: entree.rpId,
      compteur,
      verifie: entree.verifie !== false,
    });
    const donneesClient = this.donneesClient({
      type: entree.type ?? 'webauthn.get',
      defi: entree.defi,
      origine: entree.origine,
    });

    // La signature couvre les données d'authentificateur suivies de l'empreinte des
    // données du client : c'est ce qui lie l'assertion au défi et à l'origine.
    const aSigner = Buffer.concat([
      Buffer.from(donneesAuth),
      createHash('sha256').update(donneesClient).digest(),
    ]);
    const signataire = entree.signeAvec ?? this;
    const signature = sign('sha256', aSigner, signataire.clePrivee);

    const identifiant = entree.identifiant ?? this.identifiant;
    return {
      id: identifiant,
      rawId: identifiant,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(donneesClient),
        authenticatorData: isoBase64URL.fromBuffer(donneesAuth),
        signature: isoBase64URL.fromBuffer(octets(signature)),
        ...(entree.sansPorteur
          ? {}
          : {
              userHandle: isoBase64URL.fromBuffer(
                octets(Buffer.from(entree.porteur ?? this.porteur, 'utf8')),
              ),
            }),
      },
    };
  }
}

import { z } from 'zod';

/**
 * Clés d'accès — connexion sans mot de passe (WebAuthn).
 *
 * Un mot de passe se lit par-dessus l'épaule, se rejoue, et se saisit sur un site qui
 * ressemble au bon. Une clé d'accès ne quitte jamais l'appareil qui la détient et ne
 * signe que pour le domaine où elle a été créée : c'est ce qui la rend insensible à
 * l'hameçonnage, et c'est la seule raison de l'ajouter.
 *
 * Le mot de passe reste en place. Une clé s'ajoute, elle ne remplace rien : un compte
 * qui n'aurait plus que sa clé serait définitivement perdu avec l'appareil.
 */

/** Durée de vie d'un défi, en secondes. Le temps d'un geste, pas davantage. */
export const DUREE_DEFI = 180;

/** Nombre de clés qu'un compte peut enregistrer. */
export const CLES_PAR_COMPTE = 10;

/** Une clé enregistrée, telle que l'écran du compte la présente. */
export interface CleAcces {
  id: string;
  libelle: string;
  creeLe: string;
  derniereUtilisation: string | null;
  /** Vraie pour une clé synchronisée — trousseau iCloud, gestionnaire de mots de passe. */
  synchronisee: boolean;
}

/**
 * Ouverture d'une cérémonie d'enregistrement.
 *
 * Le mot de passe actuel est exigé : une session dérobée ne doit pas suffire à poser
 * une clé, qui serait un accès durable qu'un changement de mot de passe ne refermerait
 * pas.
 */
export const zDemandeEnregistrementCle = z.object({
  motDePasse: z.string().min(1).max(200),
});

/**
 * Une valeur en base64url, bornée.
 *
 * La réponse d'un authentificateur est le seul endroit du logiciel où des octets
 * fournis par le client atteignent un décodeur binaire. Sans borne de taille et sans
 * contrôle de l'alphabet, un corps de plusieurs mégaoctets arriverait jusqu'au
 * décodeur CBOR : la validation aux frontières est ce qui l'en empêche.
 */
const zBase64Url = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(/^[A-Za-z0-9_-]+$/, 'Valeur attendue en base64url, sans remplissage.');

/** Les transports que la spécification connaît. Le reste est écarté en silence. */
export const TRANSPORTS_CONNUS = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
] as const;

/** Réponse de l'authentificateur à un enregistrement, telle que le navigateur la rend. */
export const zReponseEnregistrement = z.object({
  // La spécification autorise un identifiant de justificatif jusqu'à 1023 octets, soit
  // 1364 caractères en base64url. Une borne plus serrée refuserait des authentificateurs
  // parfaitement légitimes.
  id: zBase64Url(1400),
  rawId: zBase64Url(1400),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: zBase64Url(4000),
    attestationObject: zBase64Url(20000),
    transports: z.array(z.string().max(20)).max(8).optional(),
  }),
});

/** Réponse de l'authentificateur à une connexion. */
export const zReponseAssertion = z.object({
  id: zBase64Url(1400),
  rawId: zBase64Url(1400),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: zBase64Url(4000),
    authenticatorData: zBase64Url(4000),
    signature: zBase64Url(1000),
    /**
     * Le porteur annoncé par l'authentificateur.
     *
     * Exigé : les clés sont enregistrées comme découvrables, et la spécification veut
     * qu'une telle clé le rapporte. C'est ce qui permet de vérifier que le justificatif
     * trouvé en base va bien avec le compte que l'authentificateur croit ouvrir.
     */
    userHandle: zBase64Url(200),
  }),
});

/** Achèvement d'une cérémonie d'enregistrement. */
export const zEnregistrementCle = z.object({
  demande: z.string().min(1).max(80),
  libelle: z.string().max(80).default(''),
  reponse: zReponseEnregistrement,
});

/** Achèvement d'une cérémonie de connexion. */
export const zConnexionCle = z.object({
  demande: z.string().min(1).max(80),
  reponse: zReponseAssertion,
});

/**
 * Une cérémonie ouverte : l'identifiant opaque du défi, et les options à passer au
 * navigateur.
 *
 * Le défi lui-même ne circule que dans les options ; le serveur garde son exemplaire et
 * ne fait jamais confiance à ce que le client lui renvoie.
 */
export interface CeremonieCle {
  demande: string;
  options: Record<string, unknown>;
}

/**
 * Changement de mot de passe.
 *
 * Fermer les sessions ne suffit pas : un connecteur autorisé garde trente jours
 * d'accès aux dossiers, accordé avec le mot de passe qu'on vient de changer. La
 * révocation est donc proposée avec, et cochée par défaut.
 */
export const zChangementMotDePasse = z.object({
  ancien: z.string().min(1).max(200),
  nouveau: z.string().min(10).max(200),
  revoquerConnecteurs: z.boolean().default(true),
});

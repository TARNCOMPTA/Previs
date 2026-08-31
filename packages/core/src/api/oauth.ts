import { z } from 'zod';

/**
 * Autorisation OAuth 2.1 du point d'entrée MCP.
 *
 * Un jeton d'API suffit à un client qui sait poser un en-tête — Claude Code, un appel
 * en ligne de commande. Les connecteurs de claude.ai et Claude Desktop, eux, n'ouvrent
 * qu'un formulaire OAuth : il leur faut un serveur d'autorisation en règle.
 *
 * Le flux retenu est le seul que la spécification MCP admette : code d'autorisation
 * avec PKCE obligatoire, client public enregistré dynamiquement, et jeton d'accès de
 * courte durée accompagné d'un jeton de rafraîchissement.
 */

/** Portée unique : l'accès complet aux dossiers, dans la limite du rôle du compte. */
export const PORTEE_DOSSIERS = 'previs:dossiers';

/** Durées de vie, en secondes. */
export const DUREE_CODE = 600;
export const DUREE_ACCES = 3600;
export const DUREE_RAFRAICHISSEMENT = 30 * 86400;

/** Préfixes distinguant les trois sortes de jetons émis. */
export const PREFIXE_ACCES = 'previs_at_';
export const PREFIXE_RAFRAICHISSEMENT = 'previs_rt_';
export const PREFIXE_CODE = 'previs_ac_';

/**
 * Métadonnées de la ressource protégée (RFC 9728).
 *
 * C'est par là qu'un client découvre quel serveur d'autorisation interroger, après
 * avoir reçu un 401 accompagné de l'en-tête `WWW-Authenticate`.
 */
export interface MetadonneesRessource {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_documentation?: string;
}

/** Métadonnées du serveur d'autorisation (RFC 8414). */
export interface MetadonneesAutorisation {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
}

/**
 * Enregistrement dynamique d'un client (RFC 7591).
 *
 * Seules les adresses de redirection comptent : elles sont le seul rempart contre le
 * détournement du code d'autorisation, et sont comparées ensuite caractère par caractère.
 */
export const zEnregistrementClient = z.object({
  // Bornée en longueur : dix adresses sans plafond laissaient une requête anonyme écrire
  // près d'un mégaoctet dans une table que rien ne purgeait.
  redirect_uris: z.array(z.string().url().max(400)).min(1).max(10),
  client_name: z.string().max(200).optional(),
  client_uri: z.string().url().max(500).optional(),
  logo_uri: z.string().url().max(500).optional(),
  scope: z.string().max(200).optional(),
  grant_types: z.array(z.string()).max(10).optional(),
  response_types: z.array(z.string()).max(10).optional(),
  token_endpoint_auth_method: z.string().max(40).optional(),
});
export type EnregistrementClient = z.infer<typeof zEnregistrementClient>;

export interface ClientEnregistre {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

/** Paramètres de la requête d'autorisation. */
export const zRequeteAutorisation = z.object({
  response_type: z.string(),
  client_id: z.string().min(1).max(120),
  redirect_uri: z.string().min(1).max(2000),
  /**
   * PKCE est obligatoire : la spécification MCP l'exige, et sans lui un code
   * intercepté suffirait à obtenir un jeton.
   */
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string(),
  state: z.string().max(500).optional(),
  scope: z.string().max(200).optional(),
  /** Indicateur de ressource (RFC 8707) : à quel serveur le jeton est destiné. */
  resource: z.string().max(500).optional(),
});
export type RequeteAutorisation = z.infer<typeof zRequeteAutorisation>;

/** Échange du code contre un jeton, ou rafraîchissement. */
export const zRequeteJetonOauth = z.object({
  grant_type: z.string(),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  client_id: z.string().max(120).optional(),
  code_verifier: z.string().min(43).max(128).optional(),
  refresh_token: z.string().max(200).optional(),
  resource: z.string().max(500).optional(),
});

export interface ReponseJetonOauth {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/** Erreur OAuth, telle que la spécification l'attend dans le corps de la réponse. */
export interface ErreurOauth {
  error: string;
  error_description?: string;
}

/**
 * Autorisation en cours, telle que l'écran Administration la présente.
 *
 * L'écran de consentement promet que l'autorisation est révocable : elle doit donc
 * être visible quelque part, avec le compte auquel elle donne accès.
 */
export interface AutorisationOauth {
  utilisateurId: string;
  compte: string;
  courriel: string;
  clientId: string;
  nomClient: string;
  accordeeLe: string;
  expireLe: string;
}

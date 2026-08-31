import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from '@simplewebauthn/browser';
import type { CleAcces, Utilisateur } from '@previs/core';
import { api } from './client.js';

/**
 * Cérémonies WebAuthn côté navigateur.
 *
 * Seul fichier de l'interface à parler à `@simplewebauthn/browser` : le geste — la
 * biométrie, le code de l'appareil — se déclenche ici et nulle part ailleurs. Les écrans
 * n'appellent que les trois fonctions du bas.
 */

/**
 * Les clés d'accès sont-elles possibles sur ce navigateur, ici et maintenant ?
 *
 * Deux conditions, et le navigateur est seul juge des deux : l'API doit exister, et la
 * page doit être servie dans un contexte sûr — https, ou la boucle locale. Rien à
 * demander au serveur : s'il a désactivé les clés faute d'adresse publique en https, le
 * point d'entrée le dira lui-même, avec le motif.
 */
export function clesPossibles(): boolean {
  return browserSupportsWebAuthn() && window.isSecureContext;
}

/**
 * Traduit l'échec d'une cérémonie en une phrase utile.
 *
 * Les messages de la bibliothèque sont en anglais et parlent de « credentials » ; ils
 * ne conviennent pas à l'écran d'un cabinet. Un abandon — la fenêtre du système fermée
 * d'un geste — ne mérite aucun message : ce n'est pas une erreur.
 */
export function messageErreurCle(erreur: unknown): string | null {
  if (erreur instanceof WebAuthnError) {
    switch (erreur.code) {
      case 'ERROR_CEREMONY_ABORTED':
        return null;
      case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
        return 'Cette clé est déjà enregistrée sur ce compte.';
      case 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY':
        return 'Aucune clé d’accès n’a pu être présentée. Réessayer, ou employer le mot de passe.';
      case 'ERROR_INVALID_DOMAIN':
        return 'L’adresse de ce site ne permet pas les clés d’accès.';
      default:
        return 'La clé d’accès n’a pas pu être employée. Réessayer, ou employer le mot de passe.';
    }
  }
  if (erreur instanceof Error && erreur.message) return erreur.message;
  return 'La clé d’accès n’a pas pu être employée.';
}

/**
 * Se connecter par clé d'accès, sans saisir ni adresse ni mot de passe.
 *
 * Aucune adresse n'est envoyée au serveur : la clé est découvrable, c'est
 * l'authentificateur qui dit quel compte il ouvre.
 */
export async function connexionParCle(): Promise<Utilisateur> {
  // Une cérémonie restée pendante fait échouer la suivante : le navigateur n'en tient
  // qu'une à la fois.
  WebAuthnAbortService.cancelCeremony();

  const { demande, options } = await api.optionsConnexionCle();
  const reponse = await startAuthentication({ optionsJSON: options });
  const { utilisateur } = await api.connexionParCle(demande, reponse);
  return utilisateur;
}

/** Enregistrer une clé sur son propre compte. Le mot de passe actuel est exigé. */
export async function enrolerCle(libelle: string, motDePasse: string): Promise<CleAcces> {
  WebAuthnAbortService.cancelCeremony();

  const { demande, options } = await api.optionsEnregistrementCle(motDePasse);
  const reponse = await startRegistration({ optionsJSON: options });
  return api.enregistrerCle(demande, libelle, reponse);
}

/** Interrompt une cérémonie en cours — à la fermeture d'une fenêtre, par exemple. */
export function annulerCeremonie(): void {
  WebAuthnAbortService.cancelCeremony();
}

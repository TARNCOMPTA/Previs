import { nouvelId } from '../model/common.js';
import { normaliserDossier, type Dossier } from '../model/dossier.js';
import type { CheminListe, Operation } from './contract.js';

type Enregistrement = Record<string, unknown>;

/**
 * Segments interdits dans un chemin pointé.
 *
 * Sans ce garde-fou, une opération `definir` portant le chemin « __proto__.x »
 * écrirait sur le prototype d'Object et contaminerait tout le processus serveur,
 * pour toutes les requêtes suivantes.
 */
const SEGMENTS_INTERDITS = new Set(['__proto__', 'prototype', 'constructor']);

/** Racines autorisées : une opération ne peut écrire que dans le dossier lui-même. */
const RACINES_AUTORISEES = new Set([
  'identite',
  'parametres',
  'investissements',
  'financements',
  'charges',
  'recettes',
  'autres',
]);

/**
 * Résout un chemin en notation pointée et renvoie le conteneur et la clé finale.
 *
 * Le chemin est strictement contraint : il doit commencer par l'une des sections du
 * dossier et ne contenir aucun segment permettant d'atteindre une chaîne de prototypes.
 * La traversée n'emprunte que des propriétés propres, jamais héritées.
 */
function resoudreChemin(
  racine: Enregistrement,
  chemin: string,
): { conteneur: Enregistrement; cle: string } | null {
  const segments = chemin.split('.').filter(Boolean);
  if (segments.length < 2) return null;
  if (!RACINES_AUTORISEES.has(segments[0])) return null;
  if (segments.some((s) => SEGMENTS_INTERDITS.has(s))) return null;

  let courant: unknown = racine;
  for (let i = 0; i < segments.length - 1; i++) {
    if (typeof courant !== 'object' || courant === null) return null;
    if (!Object.prototype.hasOwnProperty.call(courant, segments[i])) return null;
    const suivant = (courant as Enregistrement)[segments[i]];
    if (typeof suivant !== 'object' || suivant === null || Array.isArray(suivant)) return null;
    courant = suivant;
  }
  if (typeof courant !== 'object' || courant === null) return null;
  return { conteneur: courant as Enregistrement, cle: segments[segments.length - 1] };
}

/**
 * Retire d'une ligne les clés susceptibles d'atteindre une chaîne de prototypes.
 *
 * Les lignes viennent d'un enregistrement libre transmis par l'assistant : elles sont
 * ensuite fusionnées dans un objet du dossier, ce qui rendrait « __proto__ » actif.
 */
function nettoyerLigne(ligne: Enregistrement): Enregistrement {
  const propre: Enregistrement = {};
  for (const [cle, valeur] of Object.entries(ligne)) {
    if (SEGMENTS_INTERDITS.has(cle)) continue;
    propre[cle] = valeur;
  }
  return propre;
}

/** Renvoie le tableau de lignes désigné par un chemin de liste. */
function listeDe(dossier: Dossier, chemin: CheminListe): Enregistrement[] {
  const [section, propriete] = chemin.split('.') as [keyof Dossier, string];
  const conteneur = dossier[section] as unknown as Enregistrement;
  const liste = conteneur?.[propriete];
  return Array.isArray(liste) ? (liste as Enregistrement[]) : [];
}

/** Préfixe d'identifiant lisible selon la liste concernée. */
function prefixePour(chemin: CheminListe): string {
  return chemin.split('.')[1].slice(0, 3);
}

/**
 * Applique une suite d'opérations à un dossier et renvoie le dossier normalisé.
 *
 * Le dossier d'entrée n'est jamais modifié. Chaque opération est journalisée en
 * français, ce qui donne au LLM un compte rendu exact de ce qui a été écrit et
 * alimente l'historique des versions affiché dans l'interface.
 */
export function appliquerOperations(
  dossier: Dossier,
  operations: readonly Operation[],
): { dossier: Dossier; journal: string[]; erreurs: string[] } {
  const copie = structuredClone(dossier) as Dossier;
  const journal: string[] = [];
  const erreurs: string[] = [];

  for (const op of operations) {
    switch (op.action) {
      case 'definir': {
        const cible = resoudreChemin(copie as unknown as Enregistrement, op.chemin);
        if (!cible) {
          erreurs.push(`Chemin introuvable : ${op.chemin}`);
          break;
        }
        // Une valeur d'objet issue de l'assistant est nettoyée avant d'entrer au dossier.
        cible.conteneur[cible.cle] =
          op.valeur !== null && typeof op.valeur === 'object' && !Array.isArray(op.valeur)
            ? nettoyerLigne(op.valeur as Enregistrement)
            : op.valeur;
        journal.push(`${op.chemin} = ${JSON.stringify(op.valeur)}`);
        break;
      }

      case 'ajouter_ligne': {
        const liste = listeDe(copie, op.liste);
        const ligne = nettoyerLigne(op.ligne);
        if (typeof ligne.id !== 'string' || !ligne.id) ligne.id = nouvelId(prefixePour(op.liste));
        if (ligne.origine === undefined) ligne.origine = 'llm';
        liste.push(ligne);
        journal.push(`+ ${op.liste} « ${String(ligne.libelle ?? ligne.id)} »`);
        break;
      }

      case 'modifier_ligne': {
        const liste = listeDe(copie, op.liste);
        const ligne = liste.find((l) => l.id === op.id);
        if (!ligne) {
          erreurs.push(`Ligne ${op.id} introuvable dans ${op.liste}`);
          break;
        }
        Object.assign(ligne, nettoyerLigne(op.champs));
        journal.push(
          `~ ${op.liste} « ${String(ligne.libelle ?? op.id)} » : ${Object.keys(op.champs).join(', ')}`,
        );
        break;
      }

      case 'supprimer_ligne': {
        const liste = listeDe(copie, op.liste);
        const i = liste.findIndex((l) => l.id === op.id);
        if (i < 0) {
          erreurs.push(`Ligne ${op.id} introuvable dans ${op.liste}`);
          break;
        }
        const [supprimee] = liste.splice(i, 1);
        journal.push(`− ${op.liste} « ${String(supprimee.libelle ?? op.id)} »`);
        break;
      }

      case 'vider_liste': {
        const liste = listeDe(copie, op.liste);
        const n = liste.length;
        liste.length = 0;
        journal.push(`− ${op.liste} : ${n} ligne(s) supprimée(s)`);
        break;
      }
    }
  }

  return { dossier: normaliserDossier(copie), journal, erreurs };
}

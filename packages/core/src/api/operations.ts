import { nouvelId } from '../model/common.js';
import { normaliserDossier, type Dossier } from '../model/dossier.js';
import type { CheminListe, Operation } from './contract.js';

type Enregistrement = Record<string, unknown>;

/** Résout un chemin en notation pointée et renvoie le conteneur et la clé finale. */
function resoudreChemin(
  racine: Enregistrement,
  chemin: string,
): { conteneur: Enregistrement; cle: string } | null {
  const segments = chemin.split('.').filter(Boolean);
  if (segments.length === 0) return null;
  let courant: unknown = racine;
  for (let i = 0; i < segments.length - 1; i++) {
    if (typeof courant !== 'object' || courant === null) return null;
    const suivant = (courant as Enregistrement)[segments[i]];
    if (typeof suivant !== 'object' || suivant === null) return null;
    courant = suivant;
  }
  if (typeof courant !== 'object' || courant === null) return null;
  return { conteneur: courant as Enregistrement, cle: segments[segments.length - 1] };
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
        cible.conteneur[cible.cle] = op.valeur;
        journal.push(`${op.chemin} = ${JSON.stringify(op.valeur)}`);
        break;
      }

      case 'ajouter_ligne': {
        const liste = listeDe(copie, op.liste);
        const ligne = { ...op.ligne };
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
        Object.assign(ligne, op.champs);
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

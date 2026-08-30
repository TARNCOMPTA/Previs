import { z } from 'zod';
import { zSectionAutres } from './autres.js';
import { zSectionCharges } from './charges.js';
import { zSectionFinancements } from './financements.js';
import { zIdentite } from './identite.js';
import { zParametres } from './parametres.js';
import { zSectionInvestissements } from './investissements.js';
import { zSectionRecettes } from './recettes.js';

/** Version du schéma de données. Incrémentée à chaque changement cassant du modèle. */
export const VERSION_SCHEMA = 1;

/**
 * Un dossier prévisionnel complet.
 *
 * C'est l'unique objet échangé entre l'interface, le moteur de calcul, le serveur MCP
 * et le générateur PDF. Tous les champs ont une valeur par défaut : un dossier vide est
 * toujours valide, ce qui permet au LLM de le remplir section par section.
 */
export const zDossier = z.object({
  versionSchema: z.number().int().default(VERSION_SCHEMA),
  identite: zIdentite.default({}),
  parametres: zParametres.default({}),
  investissements: zSectionInvestissements.default({}),
  financements: zSectionFinancements.default({}),
  charges: zSectionCharges.default({}),
  recettes: zSectionRecettes.default({}),
  autres: zSectionAutres.default({}),
});
export type Dossier = z.infer<typeof zDossier>;

/** Les cinq sections de saisie de l'interface. */
export const SECTIONS = [
  'investissements',
  'financements',
  'charges',
  'recettes',
  'autres',
] as const;
export type Section = (typeof SECTIONS)[number];

export const LIBELLES_SECTION: Record<Section, string> = {
  investissements: 'Investissement',
  financements: 'Financement',
  charges: 'Charges',
  recettes: 'Recettes',
  autres: 'Autres',
};

/** Dossier vierge, prêt à être rempli. */
export function dossierVide(): Dossier {
  return zDossier.parse({});
}

/**
 * Valide et normalise un dossier : applique toutes les valeurs par défaut et
 * complète les tableaux « par exercice » à la bonne longueur.
 * À appeler avant tout calcul et à chaque écriture en base.
 */
export function normaliserDossier(entree: unknown): Dossier {
  const dossier = zDossier.parse(entree);
  const n = dossier.parametres.nbExercices;

  const ajuster = (t: number[] | undefined, valeurParDefaut = 0): number[] => {
    const source = t ?? [];
    return Array.from({ length: n }, (_, i) => source[i] ?? valeurParDefaut);
  };

  dossier.parametres.cfe = ajuster(dossier.parametres.cfe);

  for (const l of dossier.recettes.lignes) {
    l.montants = ajuster(l.montants);
    l.tauxCroissance = ajuster(l.tauxCroissance);
    l.quantites = ajuster(l.quantites);
    l.prixUnitaire = ajuster(l.prixUnitaire);
    l.tauxRemplissage = ajuster(l.tauxRemplissage, 100);
  }
  for (const l of dossier.charges.lignes) {
    l.montants = ajuster(l.montants);
    l.pourcentages = ajuster(l.pourcentages);
  }
  for (const p of dossier.charges.personnel) {
    p.effectifs = ajuster(p.effectifs);
    p.brutMensuel = ajuster(p.brutMensuel);
    p.nbMoisParExercice = ajuster(p.nbMoisParExercice, 12);
    p.primes = ajuster(p.primes);
    p.aides = ajuster(p.aides);
  }
  for (const a of dossier.financements.apports) {
    a.remboursements = ajuster(a.remboursements);
  }
  for (const e of dossier.autres.exceptionnels) {
    e.montants = ajuster(e.montants);
  }
  for (const d of dossier.autres.distributions) {
    d.montants = ajuster(d.montants);
  }

  return dossier;
}

/** Résultat d'une validation : liste d'anomalies non bloquantes. */
export type Anomalie = {
  code: string;
  gravite: 'erreur' | 'avertissement' | 'info';
  message: string;
  chemin?: string;
};

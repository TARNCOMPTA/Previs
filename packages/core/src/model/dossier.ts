import { z } from 'zod';
import { zSectionAutres } from './autres.js';
import { zSectionCharges } from './charges.js';
import { zSectionFinancements } from './financements.js';
import { zIdentite } from './identite.js';
import { zParametres } from './parametres.js';
import { zSectionInvestissements } from './investissements.js';
import { zSectionRecettes } from './recettes.js';
import { LIGNES_TOTAL_MAX, TAILLE_DOSSIER_MAX } from './common.js';

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
 * Complète les tableaux « par exercice » à la longueur attendue.
 *
 * La fonction est pure et préserve les identités : un objet dont rien ne change est
 * renvoyé tel quel. C'est ce qui permet de l'appeler à chaque frappe sans invalider
 * la mémoïsation des composants ni faire travailler le ramasse-miettes.
 */
export function ajusterSeries(dossier: Dossier): Dossier {
  const n = dossier.parametres.nbExercices;

  /** Renvoie le tableau inchangé s'il a déjà la bonne longueur. */
  const ajuster = (t: number[] | undefined, valeurParDefaut = 0): number[] => {
    if (t && t.length === n) return t;
    const source = t ?? [];
    return Array.from({ length: n }, (_, i) => source[i] ?? valeurParDefaut);
  };

  /** Applique `champs` à une ligne, en ne la recopiant que si une valeur change. */
  const ajusterLigne = <T extends Record<string, unknown>>(
    ligne: T,
    champs: ReadonlyArray<readonly [keyof T & string, number]>,
  ): T => {
    let copie: T | null = null;
    for (const [nom, valeurParDefaut] of champs) {
      const actuel = ligne[nom] as number[] | undefined;
      const suivant = ajuster(actuel, valeurParDefaut);
      if (suivant === actuel) continue;
      copie ??= { ...ligne };
      (copie as Record<string, unknown>)[nom] = suivant;
    }
    return copie ?? ligne;
  };

  /** Applique un ajustement à toutes les lignes, en préservant l'identité du tableau. */
  const ajusterListe = <T extends Record<string, unknown>>(
    lignes: T[],
    champs: ReadonlyArray<readonly [keyof T & string, number]>,
  ): T[] => {
    let modifiee = false;
    const suivantes = lignes.map((l) => {
      const ajustee = ajusterLigne(l, champs);
      if (ajustee !== l) modifiee = true;
      return ajustee;
    });
    return modifiee ? suivantes : lignes;
  };

  const parametresCfe = ajuster(dossier.parametres.cfe);
  const recettes = ajusterListe(dossier.recettes.lignes, [
    ['montants', 0],
    ['tauxCroissance', 0],
    ['quantites', 0],
    ['prixUnitaire', 0],
    ['tauxRemplissage', 100],
  ]);
  const charges = ajusterListe(dossier.charges.lignes, [
    ['montants', 0],
    ['pourcentages', 0],
  ]);
  const personnel = ajusterListe(dossier.charges.personnel, [
    ['effectifs', 0],
    ['brutMensuel', 0],
    ['nbMoisParExercice', 12],
    ['primes', 0],
    ['aides', 0],
  ]);
  const apports = ajusterListe(dossier.financements.apports, [['remboursements', 0]]);
  const exceptionnels = ajusterListe(dossier.autres.exceptionnels, [['montants', 0]]);
  const distributions = ajusterListe(dossier.autres.distributions, [['montants', 0]]);

  const rienNAChange =
    parametresCfe === dossier.parametres.cfe &&
    recettes === dossier.recettes.lignes &&
    charges === dossier.charges.lignes &&
    personnel === dossier.charges.personnel &&
    apports === dossier.financements.apports &&
    exceptionnels === dossier.autres.exceptionnels &&
    distributions === dossier.autres.distributions;

  if (rienNAChange) return dossier;

  return {
    ...dossier,
    parametres:
      parametresCfe === dossier.parametres.cfe
        ? dossier.parametres
        : { ...dossier.parametres, cfe: parametresCfe },
    recettes: recettes === dossier.recettes.lignes ? dossier.recettes : { ...dossier.recettes, lignes: recettes },
    charges:
      charges === dossier.charges.lignes && personnel === dossier.charges.personnel
        ? dossier.charges
        : { ...dossier.charges, lignes: charges, personnel },
    financements:
      apports === dossier.financements.apports
        ? dossier.financements
        : { ...dossier.financements, apports },
    autres:
      exceptionnels === dossier.autres.exceptionnels && distributions === dossier.autres.distributions
        ? dossier.autres
        : { ...dossier.autres, exceptionnels, distributions },
  };
}

/**
 * Valide et normalise un dossier de provenance inconnue.
 *
 * À appeler aux frontières — lecture en base, requête HTTP, écriture du serveur MCP —
 * et non sur le chemin de la saisie : la validation zod représente à elle seule la
 * moitié du coût d'un recalcul. Une fois le dossier typé, `ajusterSeries()` suffit.
 */
export function normaliserDossier(entree: unknown): Dossier {
  return ajusterSeries(zDossier.parse(entree));
}

/** Les douze listes adressables, pour compter les lignes du dossier entier. */
const LISTES_DU_DOSSIER: ReadonlyArray<readonly [keyof Dossier, string]> = [
  ['investissements', 'lignes'],
  ['investissements', 'cessions'],
  ['financements', 'apports'],
  ['financements', 'emprunts'],
  ['financements', 'subventions'],
  ['financements', 'creditsBaux'],
  ['charges', 'lignes'],
  ['charges', 'personnel'],
  ['recettes', 'lignes'],
  ['autres', 'exceptionnels'],
  ['autres', 'distributions'],
  ['autres', 'passifDeclare'],
];

/**
 * Vérifie l'ampleur d'un dossier : nombre total de lignes, et poids sérialisé.
 *
 * `LIGNES_MAX` est posé par LISTE, et il y a douze listes : à lui seul, il laissait passer
 * un dossier de vingt mégaoctets dont chaque plafond documenté était pourtant respecté.
 * Ces deux bornes-ci portent sur le dossier entier, et c'est le seul endroit d'où l'on voit
 * ce que le dossier pèse réellement.
 *
 * À appeler sur le chemin d'ÉCRITURE seulement, jamais à la lecture : un dossier déjà en
 * base, si volumineux soit-il, doit rester consultable — on ne refuse pas d'afficher ce
 * qu'on a accepté d'écrire.
 *
 * Rend le motif du refus, ou `null` si le dossier tient dans les bornes.
 */
/**
 * Longueur d'une chaîne en OCTETS UTF-8, et non en unités de code UTF-16.
 *
 * `chaine.length` compte des unités de code : un « é » en vaut une pour deux octets, un
 * « € » une pour trois. Le plafond, qui se veut un poids, laissait donc passer jusqu'à trois
 * fois sa valeur — mesuré, 3,91 Mio stockés et acceptés, et le message de refus annonçait des
 * kilo-octets qui n'en étaient pas. Le décompte s'arrête dès que le plafond est franchi :
 * savoir de combien n'ajoute rien, et un dossier démesuré est justement celui qu'on ne veut
 * pas parcourir en entier.
 */
function octetsUtf8(chaine: string, arret: number): number {
  let n = 0;
  for (let i = 0; i < chaine.length; i += 1) {
    const c = chaine.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // Paire de substitution : deux unités de code UTF-16 pour quatre octets UTF-8.
      n += 4;
      i += 1;
    } else n += 3;
    if (n > arret) return n;
  }
  return n;
}

export function verifierAmpleurDossier(dossier: Dossier): string | null {
  let lignes = 0;
  for (const [section, propriete] of LISTES_DU_DOSSIER) {
    const conteneur = dossier[section] as unknown as Record<string, unknown>;
    const liste = conteneur?.[propriete];
    if (Array.isArray(liste)) lignes += liste.length;
  }
  if (lignes > LIGNES_TOTAL_MAX) {
    return (
      `Ce dossier compte ${lignes} lignes, toutes sections confondues, pour un maximum de ` +
      `${LIGNES_TOTAL_MAX}. Un dossier prévisionnel de cabinet en compte quelques dizaines : ` +
      'répartir le travail sur plusieurs dossiers, ou regrouper les postes.'
    );
  }

  const octets = octetsUtf8(JSON.stringify(dossier), TAILLE_DOSSIER_MAX);
  if (octets > TAILLE_DOSSIER_MAX) {
    // Le poids exact n'est pas annoncé : le décompte s'arrête au plafond, et prétendre le
    // connaître donnerait deux fois le même nombre.
    return (
      `Ce dossier dépasse le poids maximal de ${Math.round(TAILLE_DOSSIER_MAX / 1024)} Ko. ` +
      'Les clés de répartition mensuelles et les notes de ligne sont ce qui pèse le plus : ' +
      'en alléger quelques-unes suffit.'
    );
  }
  return null;
}

/** Résultat d'une validation : liste d'anomalies non bloquantes. */
export type Anomalie = {
  code: string;
  gravite: 'erreur' | 'avertissement' | 'info';
  message: string;
  chemin?: string;
};

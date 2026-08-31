import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { PREFIXE_JETON } from '@previs/core';

// `promisify` retient la surcharge à trois arguments : on rétablit celle qui accepte
// les paramètres de coût, seule utile ici.
const scryptAsync = promisify(scrypt) as (
  motDePasse: string | Buffer,
  sel: string | Buffer,
  longueur: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** Paramètres de dérivation : coût mémoire de 16 Mo, sortie de 64 octets. */
const COUT = 16384;
const BLOC = 8;
const PARALLELISME = 1;
const LONGUEUR = 64;

/**
 * Hache un mot de passe avec scrypt et un sel aléatoire.
 * Le format stocké est `scrypt$N$r$p$sel$empreinte`, en base64url.
 */
export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const empreinte = await scryptAsync(motDePasse.normalize('NFKC'), sel, LONGUEUR, {
    N: COUT,
    r: BLOC,
    p: PARALLELISME,
  });
  return [
    'scrypt',
    COUT,
    BLOC,
    PARALLELISME,
    sel.toString('base64url'),
    empreinte.toString('base64url'),
  ].join('$');
}

/** Vérifie un mot de passe en temps constant. */
export async function verifierMotDePasse(motDePasse: string, stocke: string): Promise<boolean> {
  const parties = stocke.split('$');
  if (parties.length !== 6 || parties[0] !== 'scrypt') return false;
  const [, n, r, p, selEncode, empreinteEncodee] = parties;
  try {
    const sel = Buffer.from(selEncode, 'base64url');
    const attendue = Buffer.from(empreinteEncodee, 'base64url');
    const calculee = await scryptAsync(motDePasse.normalize('NFKC'), sel, attendue.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
  } catch {
    return false;
  }
}

/** Identifiant opaque de session, non devinable. */
export function nouvelIdentifiantSession(): string {
  return randomBytes(32).toString('base64url');
}

/** Jeton d'API en clair, remis une seule fois à sa création. */
export function nouveauJeton(): string {
  return PREFIXE_JETON + randomBytes(32).toString('base64url');
}

/**
 * Empreinte d'un jeton d'API. Seule l'empreinte est stockée : une copie de la base
 * ne permet donc pas de rejouer un jeton.
 */
export function empreinteJeton(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

/** Identifiant court et lisible pour une entité applicative. */
export function nouvelIdentifiant(prefixe: string): string {
  return `${prefixe}_${randomBytes(9).toString('base64url')}`;
}

/**
 * Limiteur de tentatives de connexion, en mémoire.
 *
 * La clé est libre : le service en tient deux, l'une par adresse et l'autre par
 * compte visé. La première arrête un essai de mots de passe en série depuis un
 * poste, la seconde un essai réparti sur plusieurs adresses contre un même compte.
 */
export class LimiteurConnexions {
  private readonly tentatives = new Map<string, { compte: number; jusqua: number }>();

  constructor(
    private readonly maximum = 10,
    private readonly fenetreMs = 15 * 60 * 1000,
  ) {}

  bloque(cle: string, maintenant = Date.now()): boolean {
    const entree = this.tentatives.get(cle);
    if (!entree) return false;
    if (maintenant > entree.jusqua) {
      this.tentatives.delete(cle);
      return false;
    }
    return entree.compte >= this.maximum;
  }

  echec(cle: string, maintenant = Date.now()): void {
    const entree = this.tentatives.get(cle);
    if (!entree || maintenant > entree.jusqua) {
      purger(this.tentatives, maintenant);
      this.tentatives.set(cle, { compte: 1, jusqua: maintenant + this.fenetreMs });
      return;
    }
    entree.compte += 1;
  }

  succes(cle: string): void {
    this.tentatives.delete(cle);
  }
}

/**
 * Limiteur de débit générique pour les opérations coûteuses.
 *
 * L'export PDF lance un rendu Chromium : quelques appels en boucle suffisent à
 * saturer le processeur du serveur. Un compte authentifié reste donc plafonné.
 */
export class LimiteurDebit {
  private readonly appels = new Map<string, { compte: number; jusqua: number }>();

  constructor(
    private readonly maximum: number,
    private readonly fenetreMs: number,
  ) {}

  /** Enregistre un appel et indique s'il reste sous le plafond. */
  autoriser(cle: string, maintenant = Date.now()): boolean {
    const entree = this.appels.get(cle);
    if (!entree || maintenant > entree.jusqua) {
      purger(this.appels, maintenant);
      this.appels.set(cle, { compte: 1, jusqua: maintenant + this.fenetreMs });
      return true;
    }
    entree.compte += 1;
    return entree.compte <= this.maximum;
  }
}

/** Nombre de clés au-delà duquel un compteur en mémoire est nettoyé. */
const CLES_MAX = 10000;

/**
 * Retire les fenêtres expirées, et n'évince jamais un compteur élevé.
 *
 * Sans purge, un attaquant faisant défiler des adresses inventées ferait croître la table
 * indéfiniment : la limitation deviendrait elle-même le déni de service.
 *
 * Mais vider la table au-delà du plafond, ce que faisait la version précédente, rendait à
 * l'attaquant exactement ce qu'il cherchait : dix mille adresses inventées suffisaient à
 * remettre à zéro le compteur du compte visé. Le commentaire d'alors s'en consolait en
 * disant que « l'essai en série reste arrêté par la clé d'adresse » — c'était faux, les
 * compteurs d'adresse vivent dans la même table et étaient vidés avec le reste.
 *
 * L'éviction porte donc sur les compteurs les PLUS BAS. Un compteur élevé a coûté des
 * tentatives réelles à celui qui l'a fait monter : c'est précisément celui qu'il ne faut pas
 * lui rendre. Et il n'y a pas de moyen économique de fabriquer dix mille compteurs élevés.
 */
function purger(table: Map<string, { compte: number; jusqua: number }>, maintenant: number): void {
  if (table.size < 64) return;
  for (const [cle, entree] of table) {
    if (maintenant > entree.jusqua) table.delete(cle);
  }
  if (table.size < CLES_MAX) return;

  // Toujours au-dessus du plafond : on ramène la table à la moitié en évinçant les
  // compteurs les plus bas, jamais la table entière.
  const parCompteCroissant = [...table.entries()].sort((a, b) => a[1].compte - b[1].compte);
  const aRetirer = table.size - Math.floor(CLES_MAX / 2);
  for (let i = 0; i < aRetirer && i < parCompteCroissant.length; i++) {
    table.delete(parCompteCroissant[i][0]);
  }
}

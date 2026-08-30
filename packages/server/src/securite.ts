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
 * Dix échecs par adresse et par quart d'heure : suffisant pour arrêter un essai
 * de mots de passe en série sans gêner un utilisateur qui se trompe de frappe.
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
      this.tentatives.set(cle, { compte: 1, jusqua: maintenant + this.fenetreMs });
      return;
    }
    entree.compte += 1;
  }

  succes(cle: string): void {
    this.tentatives.delete(cle);
  }
}

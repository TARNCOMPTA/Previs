import { CABINET_PAR_DEFAUT, zCabinet, TYPES_LOGO, type Cabinet } from '@previs/core';
import type { BaseDonnees } from './base.js';

/**
 * Identité du cabinet, unique pour toute l'installation.
 *
 * Elle est conservée en une seule ligne : le logiciel sert un cabinet, pas plusieurs.
 * Au premier démarrage, la ligne est créée avec les coordonnées de TARN COMPTA ;
 * tout est ensuite modifiable depuis l'écran Administration.
 */
export class ServiceCabinet {
  constructor(private readonly base: BaseDonnees) {
    this.initialiser();
  }

  private initialiser(): void {
    const existe = this.base.prepare('SELECT 1 FROM cabinet WHERE id = 1').get();
    if (existe) return;
    this.base
      .prepare('INSERT INTO cabinet (id, contenu, modifie_le) VALUES (1, ?, ?)')
      .run(JSON.stringify(CABINET_PAR_DEFAUT), new Date().toISOString());
  }

  lire(): Cabinet {
    const ligne = this.base.prepare('SELECT contenu FROM cabinet WHERE id = 1').get() as
      | { contenu: string }
      | undefined;
    if (!ligne) return CABINET_PAR_DEFAUT;
    // Le schéma complète les champs qu'une version antérieure du logiciel ignorait.
    return zCabinet.parse(JSON.parse(ligne.contenu));
  }

  /** Fusionne les champs fournis avec l'identité en place et renvoie le résultat. */
  enregistrer(modifications: Partial<Cabinet>): Cabinet {
    const fusionne = zCabinet.parse({ ...this.lire(), ...modifications });
    this.base
      .prepare('UPDATE cabinet SET contenu = ?, modifie_le = ? WHERE id = 1')
      .run(JSON.stringify(fusionne), new Date().toISOString());
    return fusionne;
  }
}

/** Signatures des formats d'image acceptés, en base64 et en tête de flux. */
const SIGNATURES: Record<string, readonly number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

/**
 * Ce qu'un logo peut mesurer, en pixels.
 *
 * Le plafond du contrat porte sur le POIDS de l'URI de données — 700 000 caractères — et le
 * poids ne dit rien de la surface : un PNG en niveaux de gris de 20 000 × 20 000 pixels,
 * entièrement conforme, tient en 389 Ko. Il passe la signature, il passe zod, et il fait
 * passer l'export du dossier de 677 ms à 27,8 secondes en creusant quatre gigaoctets de
 * mémoire dans Chromium. Le délai d'impression, à soixante secondes, ne se déclenche pas.
 *
 * Et le logo est PERSISTANT : posé une fois, il empoisonne tous les exports ultérieurs du
 * dossier, y compris ceux d'un autre collaborateur. Sur le logo du cabinet, tous les
 * dossiers.
 *
 * Les bornes sont larges. Le logo n'est jamais imprimé plus grand qu'un cartouche de
 * couverture : soixante millimètres à 300 points par pouce font sept cents pixels.
 */
const COTE_MAX = 4000;
const PIXELS_MAX = 8_000_000;

/**
 * Dimensions d'une image, lues dans son en-tête. `null` si l'en-tête est illisible.
 *
 * Rien n'est décodé : seuls les quelques octets qui portent la taille sont lus. C'est ce
 * qui permet de refuser une image démesurée sans jamais l'ouvrir.
 */
function dimensions(type: string, o: Buffer): { largeur: number; hauteur: number } | null {
  if (type === 'image/png') {
    // Signature (8) + longueur (4) + « IHDR » (4), puis largeur et hauteur en 32 bits.
    if (o.length < 24 || o.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return { largeur: o.readUInt32BE(16), hauteur: o.readUInt32BE(20) };
  }

  if (type === 'image/jpeg') {
    // Parcours des marqueurs jusqu'au premier SOF, qui porte les dimensions.
    let i = 2;
    while (i + 9 < o.length) {
      if (o[i] !== 0xff) return null;
      const marqueur = o[i + 1];
      if (marqueur === 0xd8 || marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7)) {
        i += 2;
        continue;
      }
      const longueur = o.readUInt16BE(i + 2);
      const estSof =
        marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc;
      if (estSof) return { hauteur: o.readUInt16BE(i + 5), largeur: o.readUInt16BE(i + 7) };
      if (longueur < 2) return null;
      i += 2 + longueur;
    }
    return null;
  }

  if (type === 'image/webp') {
    const forme = o.subarray(12, 16).toString('latin1');
    if (forme === 'VP8X' && o.length >= 30) {
      // Toile étendue : deux entiers de 24 bits, en petit-boutiste, diminués de un.
      const l = o[24] | (o[25] << 8) | (o[26] << 16);
      const h = o[27] | (o[28] << 8) | (o[29] << 16);
      return { largeur: l + 1, hauteur: h + 1 };
    }
    if (forme === 'VP8L' && o.length >= 25) {
      const bits = o.readUInt32LE(21);
      return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (forme === 'VP8 ' && o.length >= 30) {
      // Le code de synchronisation précède les dimensions, sur quatorze bits chacune.
      if (!(o[23] === 0x9d && o[24] === 0x01 && o[25] === 0x2a)) return null;
      return { largeur: o.readUInt16LE(26) & 0x3fff, hauteur: o.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }

  return null;
}

/**
 * Vérifie qu'une URI de données porte réellement l'image qu'elle annonce.
 *
 * Le type déclaré dans l'en-tête est choisi par celui qui téléverse : sans contrôle
 * des octets, n'importe quel contenu passerait pour une image et serait servi comme
 * telle au navigateur comme à Chromium.
 */
export function verifierLogo(logo: string): { ok: true } | { ok: false; raison: string } {
  if (logo === '') return { ok: true };

  const separateur = logo.indexOf(',');
  const entete = logo.slice(0, separateur);
  const type = entete.slice('data:'.length, entete.indexOf(';'));
  if (!(TYPES_LOGO as readonly string[]).includes(type)) {
    return { ok: false, raison: `Format non accepté : ${type}. Déposer un PNG, un JPEG ou un WebP.` };
  }

  let octets: Buffer;
  try {
    octets = Buffer.from(logo.slice(separateur + 1), 'base64');
  } catch {
    return { ok: false, raison: 'Le logo n’est pas encodé correctement.' };
  }
  if (octets.length === 0) return { ok: false, raison: 'Le fichier déposé est vide.' };

  const attendues = SIGNATURES[type] ?? [];
  const correspond = attendues.some((signature) =>
    signature.every((octet, i) => octets[i] === octet),
  );
  if (!correspond) {
    return { ok: false, raison: 'Le contenu du fichier ne correspond pas au format annoncé.' };
  }
  // Un conteneur RIFF n'est un WebP que si les octets 8 à 11 le disent.
  if (type === 'image/webp' && octets.subarray(8, 12).toString('latin1') !== 'WEBP') {
    return { ok: false, raison: 'Le contenu du fichier ne correspond pas au format annoncé.' };
  }

  // La SURFACE, que le plafond de poids ne dit pas. Voir le commentaire de COTE_MAX.
  const taille = dimensions(type, octets);
  if (!taille || taille.largeur < 1 || taille.hauteur < 1) {
    return { ok: false, raison: 'Les dimensions de l’image sont illisibles.' };
  }
  if (taille.largeur > COTE_MAX || taille.hauteur > COTE_MAX) {
    return {
      ok: false,
      raison:
        `Image trop grande : ${taille.largeur} × ${taille.hauteur} pixels, pour un maximum de ` +
        `${COTE_MAX} de côté. Un logo n’est jamais imprimé plus large qu’un cartouche.`,
    };
  }
  if (taille.largeur * taille.hauteur > PIXELS_MAX) {
    return {
      ok: false,
      raison:
        `Image trop grande : ${taille.largeur} × ${taille.hauteur} pixels, soit plus de ` +
        `${PIXELS_MAX / 1_000_000} millions. Réduire sa définition avant de la déposer.`,
    };
  }

  return { ok: true };
}

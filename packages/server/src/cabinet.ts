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

  return { ok: true };
}

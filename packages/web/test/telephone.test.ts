import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * L'adaptation au téléphone, pour ce qui s'en éprouve sans navigateur.
 *
 * Le reste du dépôt verrouille ses corrections par un essai ; ce lot-là ne l'était pas,
 * et une retouche du CSS pouvait tout défaire en silence. Deux de ses invariants ne
 * demandent pourtant qu'à lire la source, et ce sont ceux dont l'oubli ne se voit pas :
 * un champ sous seize pixels et un `100vh` isolé produisent tous deux un écran d'apparence
 * normale, dont le défaut n'apparaît que sur un appareil réel — trop tard.
 *
 * Ce qui demande un navigateur — l'absence de débordement à sept largeurs, le calage de
 * l'onglet actif, la hauteur d'une cible tactile réellement rendue — n'est pas ici : cela
 * se regarde, comme la mise en page du PDF.
 */

const RACINE = new URL('../src/', import.meta.url).pathname;
const CSS = readFileSync(join(RACINE, 'styles/theme.css'), 'utf8');

function sourcesTsx(repertoire: string): string[] {
  return readdirSync(repertoire).flatMap((entree) => {
    const chemin = join(repertoire, entree);
    if (statSync(chemin).isDirectory()) return sourcesTsx(chemin);
    return chemin.endsWith('.tsx') || chemin.endsWith('.ts') ? [chemin] : [];
  });
}

describe('l’adaptation au téléphone', () => {
  it('aucun champ de saisie ne descend sous seize pixels', () => {
    // En deçà, Safari sur iOS AGRANDIT la page à la prise de focus et ne la réduit jamais :
    // saisir un montant laisse l'écran zoomé, et l'en-tête hors de vue. Le contrôle porte
    // sur toutes les déclarations de la feuille, pas seulement sur celles du bloc de média :
    // une règle de corps posée ailleurs sur un sélecteur de champ produirait le même défaut.
    const regles = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const fautives: string[] = [];

    for (const [, selecteurs, corps] of regles) {
      if (!/\b(input|select|textarea)\b/.test(selecteurs)) continue;
      // Les cases à cocher et les boutons radio n'ont pas de texte : le corps n'y déclenche
      // aucun agrandissement, et ils sont dimensionnés en largeur et hauteur.
      if (/type=['"](checkbox|radio)['"]/.test(selecteurs)) continue;
      const taille = /font-size:\s*([\d.]+)px/.exec(corps);
      if (taille && Number(taille[1]) < 16) {
        fautives.push(`${selecteurs.trim().replace(/\s+/g, ' ')} → ${taille[1]}px`);
      }
    }

    expect(fautives).toEqual([]);
  });

  it('la règle des seize pixels est bien posée, et sous le seuil du téléphone', () => {
    // Le contrôle précédent passe aussi si la règle a disparu : il ne trouve alors rien à
    // reprocher. Celui-ci exige sa présence, à l'intérieur de la règle de média.
    const bloc = /@media \(max-width: 760px\)\s*\{([\s\S]*)\n\}/.exec(CSS);
    expect(bloc, 'le bloc @media (max-width: 760px) a disparu').not.toBeNull();
    expect(bloc?.[1]).toMatch(/input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px/);
  });

  it('aucune hauteur de fenêtre n’est exprimée en « vh » seul', () => {
    // « vh » ignore la barre d'adresse : la barre d'indicateurs se retrouve dessous. La
    // parade est « 100dvh », précédé de « 100vh » comme repli pour les moteurs anciens —
    // d'où la classe « hauteur-minimale-fenetre », qui porte les deux. Trois écrans avaient
    // gardé un « minHeight: '100vh' » en ligne, et le correctif n'y était donc pas appliqué.
    const enLigne = sourcesTsx(RACINE)
      .filter((f) => /100vh/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RACINE.length));
    expect(enLigne).toEqual([]);

    // Et dans la feuille, tout « 100vh » doit être suivi de son « 100dvh ».
    for (const [, propriete] of CSS.matchAll(/([\w-]+):\s*100vh/g)) {
      const apres = CSS.slice(CSS.indexOf(`${propriete}: 100vh`));
      expect(apres, `${propriete}: 100vh sans 100dvh`).toMatch(
        new RegExp(`${propriete}: 100vh;\\s*${propriete}: 100dvh;`),
      );
    }
  });
});

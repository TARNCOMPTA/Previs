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
  /** Le contenu de `@media (max-width: 760px)`, où le corps des champs doit valoir seize. */
  const blocTelephone = (): string => {
    const debut = CSS.indexOf('@media (max-width: 760px) {');
    expect(debut, 'le bloc @media (max-width: 760px) a disparu').toBeGreaterThan(-1);
    let profondeur = 0;
    for (let i = CSS.indexOf('{', debut); i < CSS.length; i += 1) {
      if (CSS[i] === '{') profondeur += 1;
      else if (CSS[i] === '}') {
        profondeur -= 1;
        if (profondeur === 0) return CSS.slice(CSS.indexOf('{', debut) + 1, i);
      }
    }
    throw new Error('bloc @media non refermé');
  };

  /** Les déclarations de corps posées sur un sélecteur de champ, dans un fragment de CSS. */
  function corpsDesChamps(fragment: string): { selecteur: string; px: number }[] {
    const trouvees: { selecteur: string; px: number }[] = [];
    // Les commentaires sont retirés d'abord : ils précèdent la règle et se retrouveraient
    // dans le sélecteur capturé, si bien que deux règles portant le MÊME sélecteur ne se
    // reconnaîtraient plus l'une l'autre.
    const sansCommentaires = fragment.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selecteurs, corps] of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\b(input|select|textarea)\b/.test(selecteurs)) continue;
      // Les cases à cocher et les boutons radio n'ont pas de texte : le corps n'y déclenche
      // aucun agrandissement, et ils sont dimensionnés en largeur et hauteur.
      if (/type=['"](checkbox|radio)['"]/.test(selecteurs)) continue;
      const taille = /font-size:\s*([\d.]+)px/.exec(corps);
      if (taille) trouvees.push({ selecteur: selecteurs.trim().replace(/\s+/g, ' '), px: Number(taille[1]) });
    }
    return trouvees;
  }

  it('sous le seuil du téléphone, aucun champ ne descend sous seize pixels', () => {
    // En deçà, Safari sur iOS AGRANDIT la page à la prise de focus et ne la réduit jamais :
    // saisir un montant laisse l'écran zoomé, et l'en-tête hors de vue.
    const fautives = corpsDesChamps(blocTelephone()).filter((r) => r.px < 16);
    expect(fautives.map((r) => `${r.selecteur} → ${r.px}px`)).toEqual([]);
  });

  it('un corps réduit posé ailleurs est bien relevé dans la règle de média', () => {
    // Une rangée compacte peut légitimement réduire le corps sur un grand écran — les douze
    // poids d'une saisonnalité tiennent en 11 px. Mais la règle de média doit alors reprendre
    // LE MÊME sélecteur : sinon le champ reste sous seize pixels sur un téléphone.
    const horsMedia = CSS.replace(blocTelephone(), '');
    const dansMedia = corpsDesChamps(blocTelephone());

    for (const reduite of corpsDesChamps(horsMedia).filter((r) => r.px < 16)) {
      const releve = dansMedia.find((r) => r.selecteur === reduite.selecteur && r.px >= 16);
      expect(releve, `${reduite.selecteur} vaut ${reduite.px}px et n’est pas relevé`).toBeDefined();
    }
  });

  it('aucun corps de champ n’est posé en style EN LIGNE', () => {
    // Un style en ligne bat toute feuille, règle de média comprise : les douze poids d'une
    // saisonnalité portaient « fontSize: 11 » en ligne, et la règle des seize pixels ne
    // pouvait rien pour eux. Le contrôle vaut pour toute taille, même supérieure à seize :
    // ce qui est interdit est de mettre le corps d'un champ hors de portée de la feuille.
    const fautifs: string[] = [];
    for (const fichier of sourcesTsx(RACINE)) {
      const source = readFileSync(fichier, 'utf8');
      for (const [, avant] of source.matchAll(/(<input[\s\S]{0,400}?)fontSize:/g)) {
        if (!/\/>|<\/input>/.test(avant)) fautifs.push(fichier.slice(RACINE.length));
      }
    }
    expect([...new Set(fautifs)]).toEqual([]);
  });

  it('la règle des seize pixels est bien posée, et sous le seuil du téléphone', () => {
    // Le contrôle précédent passe aussi si la règle a disparu : il ne trouve alors rien à
    // reprocher. Celui-ci exige sa présence, à l'intérieur de la règle de média.
    const bloc = /@media \(max-width: 760px\)\s*\{([\s\S]*)\n\}/.exec(CSS);
    expect(bloc, 'le bloc @media (max-width: 760px) a disparu').not.toBeNull();
    expect(bloc?.[1]).toMatch(/input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px/);
  });

  it('toute grille centrée borne sa piste', () => {
    // Une piste de grille non bornée se dimensionne sur son propre contenu, et le
    // « maxWidth: 100% » de l'élément se résout alors CONTRE elle : cent pour cent de 380
    // font 380, dans une place utile de 350. Le défaut est passé deux fois — la modale
    // « Nouveau dossier », puis l'écran de connexion, qui est le premier de l'application.
    // « placeItems: center » sur une grille est la signature du motif.
    const fautifs: string[] = [];
    for (const fichier of sourcesTsx(RACINE)) {
      const source = readFileSync(fichier, 'utf8');
      for (const [bloc] of source.matchAll(/style=\{\{[^}]*placeItems:\s*'center'[^}]*\}\}/g)) {
        if (!/display:\s*'grid'/.test(bloc)) continue; // un flex centré n'a pas ce défaut
        if (!/gridTemplateColumns/.test(bloc)) fautifs.push(fichier.slice(RACINE.length));
      }
    }
    expect([...new Set(fautifs)]).toEqual([]);
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

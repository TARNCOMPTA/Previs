import { describe, expect, it } from 'vitest';
import { calculer, type Dossier, type Resultats } from '@previs/core';
import { dossierComplet } from '../../core/test/aide.js';
import { construireHtml, construirePied } from '../src/pdf/document.js';

/**
 * Le document imprimé.
 *
 * Le PDF est la seule sortie que le client garde : un tableau décalé d'une colonne y est
 * définitif. Ces essais ne jugent pas la mise en page — cela se regarde — mais tout ce qui
 * peut se vérifier par le calcul :
 *
 * - **la parité des cellules.** Chaque ligne d'un tableau porte exactement autant de
 *   cellules que son en-tête a de colonnes. C'est la garantie qu'aucun tableau ne glisse,
 *   pour un à dix exercices comme pour les trois régimes.
 * - **les caractères absents des polices.** U+202F et deux signes décoratifs ne sont dans
 *   aucune des six faces incorporées : écrits tels quels ils partiraient en repli sur une
 *   police du système, et la colonne des montants cesserait d'être alignée.
 * - **les trous du gabarit.** « NaN », « undefined » et « [object Object] » sont ce qu'un
 *   gabarit produit quand une donnée manque. Aucun ne doit atteindre le papier.
 * - **le découpage mensuel.** L'annexe de trésorerie couvre exactement les mois de chaque
 *   exercice, en blocs de six colonnes au plus.
 * - **la place de l'impôt.** L'impôt sur le revenu n'est pas une charge de l'entreprise :
 *   au-dessus du résultat net il ferait croire à un résultat net d'impôt.
 *
 * Chromium n'est pas lancé : `construireHtml()` est pure, et c'est elle qui porte tout ce
 * qui peut être faux dans les chiffres.
 */

const REGIMES = ['IS', 'BNC', 'BIC_IR'] as const;
const NOMBRES_D_EXERCICES = [1, 2, 3, 10];

function dossierA(regime: (typeof REGIMES)[number], nbExercices: number): Dossier {
  const d = dossierComplet(regime);
  return { ...d, parametres: { ...d.parametres, nbExercices } };
}

function rendre(regime: (typeof REGIMES)[number], nbExercices: number): {
  dossier: Dossier;
  resultats: Resultats;
  html: string;
} {
  const dossier = dossierA(regime, nbExercices);
  const resultats = calculer(dossier);
  return { dossier, resultats, html: construireHtml(dossier, resultats) };
}

/**
 * Le document sans sa feuille de style.
 *
 * Les six polices y sont incorporées en base64, soit 160 Ko de lettres tirées au hasard où
 * « NaN » et « undefined » se rencontrent par accident. Les recherches de caractères ne
 * portent que sur le contenu.
 */
function sansStyle(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, '');
}

/**
 * Le contenu d'une section, isolé par son titre.
 *
 * Un simple `split` sur le titre ne suffit pas : celui-ci paraît d'abord dans le sommaire,
 * et « Annexe » ouvre deux sections. La découpe se fait donc sur les balises `<section>`,
 * et la section retenue est celle dont le titre est le titre cherché.
 */
function section(html: string, titre: string): string {
  const sections = html.split('<section').slice(1);
  const cherchee = sections.find((s) =>
    s.includes(`<h2 class="titre-section">${titre}</h2>`),
  );
  if (cherchee === undefined) throw new Error(`Section « ${titre} » absente du document.`);
  return cherchee;
}

interface TableauMesure {
  colonnes: number;
  lignes: number[];
  entetes: string[];
}

/** Mesure chaque tableau du document : colonnes annoncées, cellules de chaque ligne. */
function mesurerTableaux(html: string): TableauMesure[] {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((t) => {
    const contenu = t[1] ?? '';
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(contenu)?.[1] ?? '';
    const entetes = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((h) => h[1] ?? '');
    const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(contenu)?.[1] ?? '';
    const lignes = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...(r[1] ?? '').matchAll(/<td(?:\s[^>]*)?>/g)].reduce((total, cellule) => {
        const colspan = /colspan="(\d+)"/.exec(cellule[0]);
        return total + (colspan ? Number(colspan[1]) : 1);
      }, 0),
    );
    return { colonnes: entetes.length, lignes, entetes };
  });
}

describe('le document imprimé', () => {
  for (const regime of REGIMES) {
    for (const nbExercices of NOMBRES_D_EXERCICES) {
      const cas = `${regime}, ${nbExercices} exercice${nbExercices > 1 ? 's' : ''}`;

      it(`aligne toutes les cellules sur leur en-tête — ${cas}`, () => {
        const { html } = rendre(regime, nbExercices);
        const tableaux = mesurerTableaux(html);
        expect(tableaux.length).toBeGreaterThan(5);
        for (const t of tableaux) {
          expect(t.colonnes).toBeGreaterThan(1);
          for (const cellules of t.lignes) expect(cellules).toBe(t.colonnes);
        }
      });

      it(`n'écrit aucun caractère absent des polices incorporées — ${cas}`, () => {
        const contenu = sansStyle(rendre(regime, nbExercices).html);
        // U+202F, l'espace fine insécable, séparateur de milliers du moteur : le document
        // la remplace par U+00A0, seule à avoir l'avance d'un chiffre en chasse fixe.
        expect(contenu).not.toContain(' ');
        expect(contenu).not.toContain('▲');
        expect(contenu).not.toContain('→');
        expect(contenu).not.toContain('≈');
        // Les points de suspension ne sont dans aucun libellé du document : s'ils
        // paraissent, c'est que `text-overflow` a amputé un montant.
        expect(contenu).not.toContain('…');
      });

      it(`ne laisse aucun trou de gabarit — ${cas}`, () => {
        const contenu = sansStyle(rendre(regime, nbExercices).html);
        expect(contenu).not.toContain('NaN');
        expect(contenu).not.toContain('undefined');
        expect(contenu).not.toContain('[object');
        expect(contenu).not.toContain('Infinity');
      });

      it(`découpe l'annexe mensuelle en blocs de six colonnes au plus — ${cas}`, () => {
        const { resultats, html } = rendre(regime, nbExercices);
        const annexe = section(html, 'Annexe — la trésorerie mensuelle');
        const tableaux = mesurerTableaux(annexe);
        expect(tableaux.length).toBeGreaterThanOrEqual(nbExercices);

        for (const t of tableaux) {
          // La première colonne porte le libellé : six colonnes de valeurs au plus.
          expect(t.colonnes - 1).toBeLessThanOrEqual(6);
        }
        // Chaque mois du dossier paraît une fois et une seule dans les en-têtes.
        const entetes = tableaux.flatMap((t) => t.entetes);
        for (const libelle of resultats.libellesMois) {
          expect(entetes.filter((h) => h === libelle)).toHaveLength(1);
        }
        expect(entetes.filter((h) => h === 'Total')).toHaveLength(nbExercices);
      });
    }
  }

  it('laisse vide le total des lignes de solde, qui ne s’additionnent pas', () => {
    const { html } = rendre('IS', 2);
    const annexe = section(html, 'Annexe — la trésorerie mensuelle');
    // Seul le dernier bloc de colonnes de chaque exercice porte la colonne « Total » :
    // dans les blocs précédents, la dernière cellule est un mois.
    const blocs = [...annexe.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)]
      .map((t) => t[1] ?? '')
      .filter((t) => /<th[^>]*>Total<\/th>\s*<\/tr>/.test(t));
    expect(blocs).toHaveLength(2);

    let verifiees = 0;
    for (const bloc of blocs) {
      const lignes = [...bloc.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => r[1] ?? '');
      const soldes = lignes.filter((l) => l.includes('Solde initial') || l.includes('SOLDE FINAL'));
      expect(soldes).toHaveLength(2);
      for (const l of soldes) {
        const cellules = [...l.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1] ?? '');
        expect(cellules[cellules.length - 1]).toBe('');
        verifiees += 1;
      }
      // Une ligne de flux, elle, garde son total : c'est une somme qui a un sens.
      const encaissements = lignes.find((l) => l.includes('Total des encaissements')) ?? '';
      const cellulesFlux = [...encaissements.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1] ?? '');
      expect(cellulesFlux[cellulesFlux.length - 1]).not.toBe('');
    }
    expect(verifiees).toBe(4);
  });

  it('déduit l’impôt sur les sociétés au-dessus du résultat net', () => {
    const { html } = rendre('IS', 3);
    const is = html.indexOf('Impôt sur les sociétés');
    const net = html.indexOf('RÉSULTAT NET');
    expect(is).toBeGreaterThan(-1);
    expect(is).toBeLessThan(net);
    expect(html).not.toContain('Impôt sur le revenu estimé');
  });

  for (const regime of ['BNC', 'BIC_IR'] as const) {
    it(`place l’impôt sur le revenu sous le résultat net — ${regime}`, () => {
      const { html } = rendre(regime, 3);
      const ir = html.indexOf('Impôt sur le revenu estimé');
      const net = html.indexOf('RÉSULTAT NET');
      expect(ir).toBeGreaterThan(-1);
      expect(ir).toBeGreaterThan(net);
      expect(html).not.toContain('Impôt sur les sociétés');
      expect(html).toContain('n’est pas une charge de');
    });
  }

  it('réserve à la colonne de pourcentage sa part de la largeur utile', () => {
    /*
     * La colonne « % du CA » ne figure pas dans les en-têtes passés au composant, mais
     * elle est bel et bien rendue : sans être budgétée, elle volait un quart de la place
     * de chaque montant, que `table-layout: fixed` amputait alors d'un « … ».
     */
    for (const nbExercices of NOMBRES_D_EXERCICES) {
      const resultat = section(rendre('IS', nbExercices).html, 'Le compte de résultat prévisionnel');
      const tableaux = mesurerTableaux(resultat);
      expect(tableaux.length).toBeGreaterThan(0);
      // La largeur du libellé est portée par le premier en-tête de chaque bloc.
      const largeurs = [...resultat.matchAll(/<th style="width:([\d.]+)mm"/g)].map((m) => Number(m[1]));
      expect(largeurs).toHaveLength(tableaux.length);
      largeurs.forEach((largeurLibelle, i) => {
        // 174 mm de largeur utile ; chaque colonne rendue doit garder au moins 14 mm.
        const colonnes = (tableaux[i]?.colonnes ?? 1) - 1;
        expect((174 - largeurLibelle) / colonnes).toBeGreaterThan(13);
      });
    }
  });

  it('n’écrit qu’une seule colonne de pourcentage, quel que soit le nombre d’exercices', () => {
    for (const nbExercices of NOMBRES_D_EXERCICES) {
      const { html } = rendre('IS', nbExercices);
      expect([...html.matchAll(/% du CA/g)]).toHaveLength(1);
    }
  });

  it('porte les chiffres clés du dossier sur la page de synthèse', () => {
    const { resultats, html } = rendre('IS', 3);
    const synthese = section(html, 'La synthèse du prévisionnel');
    expect(synthese).toContain('Trésorerie la plus basse');
    expect(synthese).toContain('Excédent brut d’exploitation');
    // Le montant vient du moteur, sans recalcul : c'est la seule chose à vérifier.
    const ca = resultats.compteResultat[2]?.chiffreAffaires ?? 0;
    expect(ca).toBeGreaterThan(0);
    expect(synthese).toContain(String(Math.round(ca)).slice(0, 3));
  });

  it('échappe le HTML venu du dossier', () => {
    const d = dossierA('IS', 1);
    const piege = {
      ...d,
      identite: { ...d.identite, raisonSociale: '<script>alert(1)</script>' },
    };
    const html = construireHtml(piege, calculer(piege));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  describe('le pied de page', () => {
    it('porte la pagination de Chromium et les polices du dossier', () => {
      const { dossier, resultats } = rendre('IS', 3);
      const pied = construirePied(dossier, resultats);
      expect(pied).toContain('class="pageNumber"');
      expect(pied).toContain('class="totalPages"');
      // Le gabarit est rendu dans un document isolé : sans ses propres @font-face, il
      // serait la seule ligne du document composée dans la police du système.
      expect(pied).toContain("font-family: 'Hanken Grotesk'");
      expect(pied).toContain("font-family: 'IBM Plex Mono'");
      expect(pied).toContain('ATELIER DU TARN');
      expect(pied).toContain('01/2026 à 12/2028');
    });

    it('échappe le nom du client', () => {
      const d = dossierA('IS', 1);
      const piege = { ...d, identite: { ...d.identite, raisonSociale: '"><b>x' } };
      const pied = construirePied(piege, calculer(piege));
      expect(pied).not.toContain('<b>x');
      expect(pied).toContain('&lt;b&gt;');
    });
  });
});

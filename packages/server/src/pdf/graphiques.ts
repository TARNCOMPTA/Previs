import { montExact } from './nombres.js';

/**
 * Palette des graphiques, à la charte pourpre du cabinet.
 *
 * Les noms disent le rôle et non la teinte : « marque » et « marqueClaire » distinguent
 * deux séries, « positif » et « negatif » ne s'emploient que pour dire un sens, jamais
 * pour décorer. Un graphique doit rester lisible imprimé en noir et blanc : les deux
 * séries diffèrent donc autant par leur clarté que par leur teinte.
 */
export const COULEURS = {
  marque: '#5d2e7c',
  marqueClaire: '#c4a1dd',
  or: '#b8923f',
  aire: '#efe5f6',
  grille: '#ddd8e3',
  axe: '#b8b1c1',
  texte: '#6b6276',
  texteFort: '#3a3343',
  positif: '#2f7a5a',
  negatif: '#b23a48',
};

/**
 * Échelle de rang pour une répartition : du plus lourd au plus léger, puis l'or pour le
 * poste résiduel. Elle reprend l'échelle pourpre de la maquette, un cran sur deux.
 *
 * Prendre tous les crans donnait deux premières barres que l'œil ne distinguait pas —
 * vérifié au rendu sur une ventilation à deux activités. Six teintes suffisent, et le
 * plafond de « jauges » s'aligne dessus : au-delà, les postes se regroupent en un reliquat.
 * La plus claire reste le pourpre 200 : le 100 se confondrait avec la piste sur laquelle
 * la barre est posée.
 */
export const ECHELLE_RANG = [
  '#371a49',
  '#5d2e7c',
  '#8a4cb3',
  '#a673c9',
  '#c4a1dd',
  '#ddc8ec',
] as const;

/** La couleur du n-ième poste d'une répartition ; l'or est réservé au reliquat. */
export function couleurRang(rang: number, reliquat = false): string {
  if (reliquat) return COULEURS.or;
  return ECHELLE_RANG[Math.min(rang, ECHELLE_RANG.length - 1)];
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Choisit une graduation lisible pour un axe : 1, 2 ou 5 fois une puissance de dix. */
function pas(etendue: number, cible = 5): number {
  if (etendue <= 0) return 1;
  const brut = etendue / cible;
  const magnitude = Math.pow(10, Math.floor(Math.log10(brut)));
  const normalise = brut / magnitude;
  const facteur = normalise <= 1 ? 1 : normalise <= 2 ? 2 : normalise <= 5 ? 5 : 10;
  return facteur * magnitude;
}

interface Serie {
  libelle: string;
  valeurs: number[];
  couleur: string;
}

/**
 * Histogramme groupé : une grappe de barres par exercice.
 * Les valeurs négatives descendent sous la ligne de zéro, qui reste toujours tracée.
 */
export function histogramme(
  categories: readonly string[],
  series: readonly Serie[],
  options: { largeur?: number; hauteur?: number; titre?: string } = {},
): string {
  const largeur = options.largeur ?? 640;
  const hauteur = options.hauteur ?? 240;
  const marge = { haut: 18, droite: 12, bas: 30, gauche: 70 };
  const aireL = largeur - marge.gauche - marge.droite;
  const aireH = hauteur - marge.haut - marge.bas;

  const toutes = series.flatMap((s) => s.valeurs);
  const max = Math.max(0, ...toutes);
  const min = Math.min(0, ...toutes);
  const etendue = max - min || 1;
  const graduation = pas(etendue);
  const hautAxe = Math.ceil(max / graduation) * graduation || graduation;
  const basAxe = Math.floor(min / graduation) * graduation;
  const amplitude = hautAxe - basAxe || 1;

  const y = (v: number) => marge.haut + aireH - ((v - basAxe) / amplitude) * aireH;
  const largeurGroupe = aireL / Math.max(categories.length, 1);
  const largeurBarre = Math.min(38, (largeurGroupe * 0.68) / Math.max(series.length, 1));

  const morceaux: string[] = [];

  for (let v = basAxe; v <= hautAxe + 1e-9; v += graduation) {
    const py = y(v);
    const zero = Math.abs(v) < 1e-9;
    morceaux.push(
      `<line x1="${marge.gauche}" y1="${py.toFixed(1)}" x2="${largeur - marge.droite}" y2="${py.toFixed(1)}" stroke="${zero ? COULEURS.texte : COULEURS.grille}" stroke-width="${zero ? 1 : 0.7}" ${zero ? '' : 'stroke-dasharray="2 3"'} />`,
      `<text x="${marge.gauche - 6}" y="${(py + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="${COULEURS.texte}">${montExact(v)}</text>`,
    );
  }

  categories.forEach((categorie, i) => {
    const centre = marge.gauche + largeurGroupe * (i + 0.5);
    const debut = centre - (largeurBarre * series.length) / 2;
    series.forEach((serie, k) => {
      const valeur = serie.valeurs[i] ?? 0;
      const haut = Math.min(y(valeur), y(0));
      const bas = Math.max(y(valeur), y(0));
      morceaux.push(
        `<rect x="${(debut + k * largeurBarre).toFixed(1)}" y="${haut.toFixed(1)}" width="${(largeurBarre - 3).toFixed(1)}" height="${Math.max(0.5, bas - haut).toFixed(1)}" fill="${serie.couleur}" />`,
      );
    });
    morceaux.push(
      `<text x="${centre.toFixed(1)}" y="${hauteur - 14}" text-anchor="middle" font-size="10" fill="${COULEURS.texte}">${echapper(categorie)}</text>`,
    );
  });

  // La légende se tient à seize unités sous les intitulés de grappe : à dix, les deux
  // lignes se touchaient.
  const legende = series
    .map(
      (s, k) =>
        `<g transform="translate(${marge.gauche + k * 150}, ${hauteur + 4})"><rect width="9" height="9" y="-8" fill="${s.couleur}" /><text x="13" font-size="9" fill="${COULEURS.texte}">${echapper(s.libelle)}</text></g>`,
    )
    .join('');

  return `<svg class="graphique" viewBox="0 0 ${largeur} ${hauteur + 18}" width="100%" height="${hauteur + 18}" xmlns="http://www.w3.org/2000/svg">${morceaux.join('')}${legende}</svg>`;
}

/**
 * Courbe d'évolution mensuelle, avec la ligne de zéro tracée et l'aire négative
 * marquée en rouge : c'est ce qui rend un trou de trésorerie immédiatement visible.
 */
export function courbe(
  libelles: readonly string[],
  valeurs: readonly number[],
  options: { largeur?: number; hauteur?: number; couleur?: string } = {},
): string {
  const largeur = options.largeur ?? 640;
  const hauteur = options.hauteur ?? 210;
  const couleur = options.couleur ?? COULEURS.marque;
  const marge = { haut: 14, droite: 12, bas: 32, gauche: 70 };
  const aireL = largeur - marge.gauche - marge.droite;
  const aireH = hauteur - marge.haut - marge.bas;

  if (valeurs.length === 0) return '';
  const max = Math.max(0, ...valeurs);
  const min = Math.min(0, ...valeurs);
  const graduation = pas(max - min || 1);
  const hautAxe = Math.ceil(max / graduation) * graduation || graduation;
  const basAxe = Math.floor(min / graduation) * graduation;
  const amplitude = hautAxe - basAxe || 1;

  const x = (i: number) => marge.gauche + (i / Math.max(valeurs.length - 1, 1)) * aireL;
  const y = (v: number) => marge.haut + aireH - ((v - basAxe) / amplitude) * aireH;

  const morceaux: string[] = [];
  for (let v = basAxe; v <= hautAxe + 1e-9; v += graduation) {
    const py = y(v);
    const zero = Math.abs(v) < 1e-9;
    morceaux.push(
      `<line x1="${marge.gauche}" y1="${py.toFixed(1)}" x2="${largeur - marge.droite}" y2="${py.toFixed(1)}" stroke="${zero ? COULEURS.texte : COULEURS.grille}" stroke-width="${zero ? 1 : 0.7}" ${zero ? '' : 'stroke-dasharray="2 3"'} />`,
      `<text x="${marge.gauche - 6}" y="${(py + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="${COULEURS.texte}">${montExact(v)}</text>`,
    );
  }

  const aire = [
    `M ${x(0).toFixed(1)} ${y(0).toFixed(1)}`,
    ...valeurs.map((v, i) => `L ${x(i).toFixed(1)} ${y(v).toFixed(1)}`),
    `L ${x(valeurs.length - 1).toFixed(1)} ${y(0).toFixed(1)} Z`,
  ].join(' ');
  morceaux.push(`<path d="${aire}" fill="${couleur}" fill-opacity="0.12" />`);

  const trace = valeurs
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  morceaux.push(`<path d="${trace}" fill="none" stroke="${couleur}" stroke-width="1.8" />`);

  valeurs.forEach((v, i) => {
    if (v >= 0) return;
    morceaux.push(
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" fill="${COULEURS.negatif}" />`,
    );
  });

  const intervalle = Math.max(1, Math.ceil(valeurs.length / 12));
  libelles.forEach((libelle, i) => {
    if (i % intervalle !== 0) return;
    morceaux.push(
      `<text x="${x(i).toFixed(1)}" y="${hauteur - 14}" text-anchor="middle" font-size="8" fill="${COULEURS.texte}" transform="rotate(-40 ${x(i).toFixed(1)} ${hauteur - 14})">${echapper(libelle)}</text>`,
    );
  });

  return `<svg class="graphique" viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}" xmlns="http://www.w3.org/2000/svg">${morceaux.join('')}</svg>`;
}


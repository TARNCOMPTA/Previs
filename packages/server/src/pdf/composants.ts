import { couleurRang } from './graphiques.js';
import { largeurMaximale, mont, montExact, pct } from './nombres.js';

/**
 * Les pièces du document imprimé.
 *
 * C'est le seul fichier qui connaît une couleur, une taille ou un millimètre : `document.ts`
 * décrit ce qu'il veut montrer, jamais comment cela se dessine. Cette séparation est ce qui
 * a permis de changer de charte sans toucher aux dix-sept sections du dossier.
 */

/** Échappe le contenu du dossier : il vient du client, jamais du gabarit. */
export function e(texte: unknown): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Titrage ─────────────────────────────────────────────────────────────────

/**
 * Le trio surtitre / titre / chapeau qui ouvre chaque section.
 *
 * Le numéro du surtitre vient du rang de la section dans le document : il est donc le même
 * que celui du sommaire, alors que la maquette faisait diverger les deux.
 */
export function titreSection(entree: {
  numero?: number;
  court?: string;
  titre: string;
  chapeau?: string;
}): string {
  const surtitre =
    entree.numero !== undefined
      ? `${String(entree.numero).padStart(2, '0')} — ${entree.court ?? entree.titre}`
      : (entree.court ?? '');
  return (
    (surtitre ? `<div class="surtitre">${e(surtitre)}</div>` : '') +
    `<h2 class="titre-section">${e(entree.titre)}</h2>` +
    (entree.chapeau ? `<p class="chapeau">${e(entree.chapeau)}</p>` : '')
  );
}

// ─── Tableaux ────────────────────────────────────────────────────────────────

/** Le degré d'une ligne, du plus discret au plus fort. */
export type DegreLigne = 'detail' | 'normale' | 'groupe' | 'sous-total' | 'total' | 'resultat';

export interface LignePdf {
  libelle: string;
  valeurs: readonly number[];
  degre?: DegreLigne;
  /**
   * La part du chiffre d'affaires, s'il y a une colonne de pourcentage.
   *
   * Une seule valeur, jamais une par exercice : la colonne est unique. L'ancien
   * générateur en émettait n, pour un en-tête qui n'en annonçait qu'une — le tableau
   * était décalé pour tout nombre d'exercices.
   */
  part?: number | null;
  /** Faux pour qu'un zéro s'écrive « 0 » plutôt qu'un tiret. */
  vide?: boolean;
  /**
   * Cellules déjà composées, quand elles ne sont pas des montants : un taux, une durée
   * en jours, un ratio avec son unité.
   *
   * Elles remplacent le formatage de `valeurs`, mais `valeurs` reste renseignée — c'est
   * elle qui porte le signe, donc la couleur d'un négatif, et qui donne au calcul de
   * largeur des colonnes de quoi mesurer.
   */
  textes?: readonly string[];
}

/** Une cellule de montant. Le négatif se voit à la couleur, pas seulement au signe. */
export function celluleMontant(valeur: number, options: { vide?: boolean } = {}): string {
  const texte = options.vide === false ? montExact(valeur) : mont(valeur);
  const classes = ['nombre', valeur < 0 ? 'negatif' : ''].filter(Boolean).join(' ');
  return `<td class="${classes}">${texte}</td>`;
}

/**
 * Une ligne de tableau.
 *
 * Le nombre de cellules est toujours `1 + valeurs.length + (colonnePart ? 1 : 0)` : c'est
 * ce qui garantit qu'un tableau ne se décale pas.
 */
export function ligne(l: LignePdf, colonnePart = false): string {
  const degre = l.degre ?? 'normale';
  if (degre === 'groupe') {
    const colonnes = 1 + l.valeurs.length + (colonnePart ? 1 : 0);
    return `<tr class="groupe"><td colspan="${colonnes}">${e(l.libelle)}</td></tr>`;
  }
  const classe = degre === 'normale' ? '' : ` class="${degre}"`;
  const cellules = l.valeurs
    .map((v, i) =>
      l.textes
        ? `<td class="nombre${v < 0 ? ' negatif' : ''}">${l.textes[i] ?? ''}</td>`
        : celluleMontant(v, { vide: l.vide }),
    )
    .join('');
  const part = colonnePart
    ? `<td class="part">${l.part === null || l.part === undefined ? '' : pct(l.part)}</td>`
    : '';
  return `<tr${classe}><td>${e(l.libelle)}</td>${cellules}${part}</tr>`;
}

/** Trois densités, du confort au serré. */
export type Densite = 'normale' | 'compacte' | 'dense';

const GEOMETRIE: Record<Densite, { taille: number; garnissage: number }> = {
  normale: { taille: 8.8, garnissage: 5.2 },
  compacte: { taille: 8, garnissage: 4 },
  dense: { taille: 7.2, garnissage: 2.8 },
};

/** Largeur utile d'une page A4 avec les marges de la feuille, en millimètres. */
const LARGEUR_UTILE = 174;
/** Ce qu'il faut au minimum à une colonne de libellé pour rester lisible. */
const LIBELLE_MINIMUM: Record<Densite, number> = { normale: 62, compacte: 52, dense: 40 };

/**
 * Répartit n colonnes de montants sur la largeur utile.
 *
 * La maquette est calibrée pour deux exercices ; le logiciel en accepte de un à dix, et
 * l'annexe mensuelle va jusqu'à vingt-quatre mois. La largeur d'une cellule est calculée
 * sur la plus longue chaîne **réellement imprimée** — et non sur un pire cas supposé —
 * ce qui fait qu'un tableau de petits montants tient là où un tableau à sept chiffres
 * demanderait un découpage.
 *
 * Rend les blocs de colonnes : un seul si tout tient, plusieurs sinon. Chaque bloc rejoue
 * l'intégralité des lignes et la colonne de libellé.
 */
export function repartirColonnes(entree: {
  nbColonnes: number;
  valeursFormatees: readonly string[];
  /** Plafond imposé, quelle que soit la place : six mois pour l'annexe de trésorerie. */
  plafondParBloc?: number;
  /**
   * Colonnes qui prennent de la largeur sans entrer dans le découpage : la colonne de
   * pourcentage du compte de résultat.
   *
   * Sans elle, la largeur était budgétée pour n colonnes alors que n+1 étaient rendues.
   * En `table-layout: fixed`, les colonnes non dimensionnées se partagent ce qui reste :
   * chaque montant recevait les trois quarts de la place qu'il lui fallait et se voyait
   * amputé — « 92 0… » pour 92 000. Vérifié au rendu sur un dossier BNC à trois exercices.
   */
  colonnesFixes?: number;
}): { blocs: number[][]; densite: Densite; largeurLibelle: number } {
  const { nbColonnes, plafondParBloc } = entree;
  const fixes = entree.colonnesFixes ?? 0;
  const signes = Math.max(5, largeurMaximale(entree.valeursFormatees));

  const tousLesIndices = Array.from({ length: nbColonnes }, (_, i) => i);
  if (nbColonnes === 0) return { blocs: [[]], densite: 'normale', largeurLibelle: LARGEUR_UTILE };

  for (const densite of ['normale', 'compacte', 'dense'] as const) {
    const { taille, garnissage } = GEOMETRIE[densite];
    // En chasse fixe chaque avance vaut 0,6 cadratin ; 1 pt vaut 0,3528 mm.
    const largeurColonne = Math.max(14, signes * 0.6 * taille * 0.3528 + garnissage);
    const place = LARGEUR_UTILE - LIBELLE_MINIMUM[densite] - fixes * largeurColonne;
    const maximum = Math.max(1, Math.floor(place / largeurColonne));
    const parBloc = plafondParBloc ? Math.min(maximum, plafondParBloc) : maximum;

    if (parBloc >= nbColonnes) {
      return {
        blocs: [tousLesIndices],
        densite,
        largeurLibelle: LARGEUR_UTILE - (nbColonnes + fixes) * largeurColonne,
      };
    }
    // Une densité plus serrée peut encore éviter le découpage : on ne découpe qu'à la fin.
    if (densite !== 'dense') continue;

    const nbBlocs = Math.ceil(nbColonnes / parBloc);
    const parBlocEgal = Math.ceil(nbColonnes / nbBlocs);
    const blocs: number[][] = [];
    for (let d = 0; d < nbColonnes; d += parBlocEgal) {
      blocs.push(tousLesIndices.slice(d, d + parBlocEgal));
    }
    return {
      blocs,
      densite,
      // Les colonnes fixes ne paraissent que sur le dernier bloc ; leur réserver la place
      // sur tous les blocs ne coûte que de la marge aux montants des blocs précédents.
      largeurLibelle: LARGEUR_UTILE - (parBlocEgal + fixes) * largeurColonne,
    };
  }
  return { blocs: [tousLesIndices], densite: 'dense', largeurLibelle: LIBELLE_MINIMUM.dense };
}

/**
 * Un tableau, éventuellement découpé en plusieurs blocs de colonnes.
 *
 * Un bloc n'est jamais un « (suite) » anonyme : son intertitre nomme les colonnes qu'il
 * porte, ce qui permet de retrouver un exercice sans compter les pages.
 */
export function tableau(entree: {
  entetes: readonly string[];
  lignes: readonly LignePdf[];
  /** Titre de la colonne de pourcentage, s'il y en a une. */
  entetePart?: string;
  /** Intitulé de chaque colonne de montant, pour nommer un bloc découpé. */
  nomsColonnes?: readonly string[];
  plafondParBloc?: number;
  note?: string;
  /** Densité imposée, pour un tableau à colonnes fixes qui serre. */
  classe?: Densite;
}): string {
  const nbColonnes = entree.entetes.length - 1;
  const colonnePart = Boolean(entree.entetePart);

  const lignesStructurees = entree.lignes;
  const formatees = lignesStructurees.flatMap((l) => [
    ...(l.textes ?? l.valeurs.map((v) => (l.vide === false ? montExact(v) : mont(v)))),
    ...(l.part === null || l.part === undefined ? [] : [pct(l.part)]),
  ]);
  const { blocs, densite, largeurLibelle } = repartirColonnes({
    nbColonnes,
    valeursFormatees: formatees,
    plafondParBloc: entree.plafondParBloc,
    colonnesFixes: colonnePart ? 1 : 0,
  });

  const classe = densite === 'normale' ? '' : ` class="${densite}"`;
  const noms = entree.nomsColonnes ?? entree.entetes.slice(1);

  const morceaux = blocs.map((indices, rang) => {
    const intertitre =
      blocs.length > 1
        ? `<div class="intertitre-bloc">${e(nommerBloc(noms, indices))}</div>`
        : '';
    const entetes =
      `<th style="width:${largeurLibelle.toFixed(1)}mm">${e(entree.entetes[0])}</th>` +
      indices.map((i) => `<th>${e(entree.entetes[i + 1] ?? '')}</th>`).join('') +
      // La colonne de pourcentage n'a de sens que sur le dernier bloc.
      (colonnePart && rang === blocs.length - 1 ? `<th>${e(entree.entetePart)}</th>` : '');

    const corps = lignesStructurees
      .map((l) =>
        ligne(
          {
            ...l,
            valeurs: indices.map((i) => l.valeurs[i] ?? 0),
            // Les textes suivent le même remappage que les valeurs : sans quoi un bloc
            // découpé afficherait les taux du premier bloc sous les en-têtes du second.
            ...(l.textes ? { textes: indices.map((i) => l.textes?.[i] ?? '') } : {}),
          },
          colonnePart && rang === blocs.length - 1,
        ),
      )
      .join('');

    return `${intertitre}<table${classe}><thead><tr>${entetes}</tr></thead><tbody>${corps}</tbody></table>`;
  });

  const note = entree.note ? `<p class="note-tableau">${e(entree.note)}</p>` : '';
  return morceaux.join('') + note;
}

/**
 * Un tableau dont les lignes sont déjà rendues en HTML.
 *
 * Réservé aux tableaux à colonnes fixes — amortissement d'emprunt, annexe de TVA — où il
 * n'y a rien à répartir. Une fonction distincte, et non une option de `tableau()` : un
 * type permissif y a laissé passer un tableau d'objets joint en chaîne, et le document a
 * imprimé « [object Object] » là où des lignes étaient attendues.
 */
export function tableauBrut(entree: {
  entetes: readonly string[];
  corps: string;
  classe?: Densite;
  note?: string;
}): string {
  const entetes = entree.entetes.map((h) => `<th>${e(h)}</th>`).join('');
  const classe = entree.classe && entree.classe !== 'normale' ? ` class="${entree.classe}"` : '';
  const note = entree.note ? `<p class="note-tableau">${e(entree.note)}</p>` : '';
  return `<table${classe}><thead><tr>${entetes}</tr></thead><tbody>${entree.corps}</tbody></table>${note}`;
}

/** « Exercices 2026 à 2030 », ou le nom unique si le bloc n'en porte qu'un. */
function nommerBloc(noms: readonly string[], indices: readonly number[]): string {
  const premier = noms[indices[0]] ?? '';
  const dernier = noms[indices[indices.length - 1]] ?? '';
  return premier === dernier ? premier : `${premier} à ${dernier}`;
}

// ─── Cartes et cartouches ────────────────────────────────────────────────────

export function carte(entree: {
  intitule?: string;
  contenu: string;
  teintee?: boolean;
  marque?: boolean;
}): string {
  const classes = ['carte', entree.teintee ? 'teintee' : '', entree.marque ? 'marque' : '']
    .filter(Boolean)
    .join(' ');
  return (
    `<div class="${classes}">` +
    (entree.intitule ? `<div class="intitule">${e(entree.intitule)}</div>` : '') +
    entree.contenu +
    '</div>'
  );
}

export interface Cartouche {
  intitule: string;
  valeur: string;
  precision?: string;
  /** Le sens d'une précision : elle se colore, ou reste neutre. */
  sens?: 'favorable' | 'defavorable' | 'neutre';
  saillant?: boolean;
}

export function cartouches(liste: readonly Cartouche[]): string {
  if (!liste.length) return '';
  const boites = liste
    .map((c) => {
      const sens = c.sens && c.sens !== 'neutre' ? ` ${c.sens}` : '';
      return (
        `<div class="cartouche${c.saillant ? ' saillant' : ''}">` +
        `<div class="intitule">${e(c.intitule)}</div>` +
        `<div class="valeur">${c.valeur}</div>` +
        (c.precision ? `<div class="precision${sens}">${c.precision}</div>` : '') +
        '</div>'
      );
    })
    .join('');
  return `<div class="cartouches">${boites}</div>`;
}

/** Liste d'indicateurs : libellé à gauche, valeur en chasse fixe à droite. */
export function indicateurs(
  liste: ReadonlyArray<{ libelle: string; valeur: string; sens?: 'favorable' | 'defavorable' }>,
): string {
  const rangees = liste
    .map(
      (i) =>
        `<div class="rangee"><span class="libelle">${e(i.libelle)}</span>` +
        `<span class="valeur${i.sens ? ` ${i.sens}` : ''}">${i.valeur}</span></div>`,
    )
    .join('');
  return `<div class="indicateurs">${rangees}</div>`;
}

/**
 * Jauges de répartition.
 *
 * La maquette intitule « Répartition » une échelle proportionnée au poste le plus élevé,
 * ce qu'un lecteur lit comme une part du total. Ici la base est explicite, et le titre la
 * dit. Une part non nulle garde une largeur minimale visible : à 0,5 %, un filet exact
 * serait invisible et la ligne paraîtrait vide.
 */
export function jauges(entree: {
  postes: ReadonlyArray<{ libelle: string; valeur: number }>;
  base?: 'total' | 'maximum';
  maximumEntrees?: number;
}): string {
  const base = entree.base ?? 'total';
  // Six, comme les six teintes de l'échelle de rang : au-delà, deux barres partageraient
  // la même couleur.
  const plafond = entree.maximumEntrees ?? 6;

  const tries = [...entree.postes].filter((p) => p.valeur !== 0).sort((a, b) => b.valeur - a.valeur);
  const retenus = tries.slice(0, plafond);
  const reste = tries.slice(plafond);
  if (reste.length) {
    retenus.push({
      libelle: `Autres postes (${reste.length})`,
      valeur: reste.reduce((s, p) => s + p.valeur, 0),
    });
  }
  if (!retenus.length) return '';

  const total = retenus.reduce((s, p) => s + Math.abs(p.valeur), 0);
  const maximum = Math.max(...retenus.map((p) => Math.abs(p.valeur)), 1);
  const reference = base === 'total' ? total || 1 : maximum;

  const rangees = retenus
    .map((p, rang) => {
      const part = (Math.abs(p.valeur) / reference) * 100;
      const largeur = Math.max(0.5, part);
      const couleur = couleurRang(rang, reste.length > 0 && rang === retenus.length - 1);
      return (
        '<div class="rangee">' +
        `<div class="tete"><span class="libelle">${e(p.libelle)}</span>` +
        `<span class="part">${mont(p.valeur)} · ${pct(part)}</span></div>` +
        `<div class="piste"><div class="remplissage" style="width:${largeur.toFixed(1)}%;background:${couleur}"></div></div>` +
        '</div>'
      );
    })
    .join('');

  return `<div class="jauges">${rangees}</div>`;
}

/** Deux blocs côte à côte, repliés en un seul quand les colonnes serrent. */
export function grille(entree: {
  gauche: string;
  droite: string;
  proportion?: 'large-etroit' | 'egale';
  replier?: boolean;
}): string {
  if (entree.replier) return `<div class="grille repliee">${entree.gauche}${entree.droite}</div>`;
  const proportion = entree.proportion ?? 'egale';
  return `<div class="grille ${proportion}">${entree.gauche}${entree.droite}</div>`;
}

/**
 * Le triangle de variation, tracé en SVG.
 *
 * U+25B2 n'existe dans aucune des six polices incorporées : écrit tel quel, il partirait
 * en repli sur une police du système, ou en carré blanc.
 */
export function triangleVariation(sens: 'hausse' | 'baisse', couleur: string): string {
  const points = sens === 'hausse' ? '3.5,0 7,6 0,6' : '0,0 7,0 3.5,6';
  return (
    `<svg width="7" height="6" viewBox="0 0 7 6" style="vertical-align:baseline;margin-right:1.4mm">` +
    `<polygon points="${points}" fill="${couleur}" /></svg>`
  );
}

/** Un encadré. Le ton dit s'il alerte, rassure, ou informe simplement. */
export function encadre(entree: {
  titre?: string;
  contenu: string;
  ton?: 'neutre' | 'alerte' | 'favorable';
}): string {
  const ton = entree.ton && entree.ton !== 'neutre' ? ` ${entree.ton}` : '';
  return (
    `<div class="encadre${ton}">` +
    (entree.titre ? `<h3>${e(entree.titre)}</h3>` : '') +
    entree.contenu +
    '</div>'
  );
}

/** Le sommaire, numéroté comme les surtitres des sections. */
export function sommaire(titres: readonly string[]): string {
  const items = titres
    .map(
      (t, i) =>
        `<li><span class="numero">${String(i + 1).padStart(2, '0')}</span><span>${e(t)}</span></li>`,
    )
    .join('');
  return `<ol class="sommaire">${items}</ol>`;
}


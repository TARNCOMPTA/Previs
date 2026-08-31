import type { CheminListe, Dossier, Exercice, Resultats } from '@previs/core';
import { useMemo, type ReactNode } from 'react';
import { useDossier } from '../../store/dossier.js';
import { Chargement } from '../../ui/divers.js';
import type { Colonne } from '../../ui/grille.js';

/** Contexte d'un écran de saisie : dossier, résultats et actions d'édition. */
export interface ContexteSection {
  dossier: Dossier;
  resultats: Resultats;
  exercices: Exercice[];
  annees: string[];
  modifier: (transformation: (d: Dossier) => void) => void;
  ajouterLigne: (liste: CheminListe, ligne: Record<string, unknown>) => string;
  modifierLigne: (liste: CheminListe, id: string, champs: Record<string, unknown>) => void;
  supprimerLigne: (liste: CheminListe, id: string) => void;
  dupliquerLigne: (liste: CheminListe, id: string) => void;
  deplacerLigne: (liste: CheminListe, id: string, sens: -1 | 1) => void;
}

/**
 * Enveloppe commune aux écrans de saisie.
 *
 * Elle attend que le dossier et un premier calcul soient disponibles, pour que les
 * écrans n'aient jamais à gérer l'absence de résultats.
 *
 * « corps » est rendu comme un COMPOSANT, non appelé comme une fonction. C'est ce qui
 * permet à un écran de saisie d'employer « useMemo » pour stabiliser ses colonnes, et donc
 * aux lignes de grille d'être mémoïsées : sans cela, une frappe redessinait les quatre-vingts
 * lignes et les huit cents champs de l'écran alors qu'une seule ligne avait changé — 17,8 ms
 * mesurées, pour un plafond de six.
 *
 * En contrepartie, « corps » doit être une référence STABLE : un composant défini au niveau
 * du module, jamais une fonction fléchée écrite dans le JSX, sans quoi React le démonterait
 * et le remonterait à chaque rendu.
 */
export function AvecDossier({ corps: Corps }: { corps: (ctx: ContexteSection) => ReactNode }) {
  const {
    dossier,
    resultats,
    modifier,
    ajouterLigne,
    modifierLigne,
    supprimerLigne,
    dupliquerLigne,
    deplacerLigne,
  } = useDossier();

  /*
   * « annees » stabilisé sur sa VALEUR, non sur l'identité de « resultats ».
   *
   * « calculer() » rend un objet neuf à chaque frappe, exercices compris : un
   * « resultats.exercices.map(...) » produisait donc un tableau neuf à chaque frappe, ce qui
   * invalidait les « useMemo » des écrans qui en dépendent — et avec eux la mémoïsation des
   * lignes de grille. Les libellés d'exercice, eux, ne changent que si les dates changent.
   */
  const signature = resultats?.exercices.map((e) => e.libelle).join('\u0001') ?? '';
  const annees = useMemo(() => (signature ? signature.split('\u0001') : []), [signature]);

  if (!dossier || !resultats) return <Chargement />;

  return (
    <Corps
      dossier={dossier}
      resultats={resultats}
      exercices={resultats.exercices}
      annees={annees}
      modifier={modifier}
      ajouterLigne={ajouterLigne}
      modifierLigne={modifierLigne}
      supprimerLigne={supprimerLigne}
      dupliquerLigne={dupliquerLigne}
      deplacerLigne={deplacerLigne}
    />
  );
}

/** En-tête d'écran : titre, texte d'explication et encadré de synthèse. */
export function EnTeteSection({
  titre,
  description,
  synthese,
}: {
  titre: string;
  description?: string;
  synthese?: ReactNode;
}) {
  return (
    <div className="pile" style={{ gap: 10 }}>
      <div>
        <h1>{titre}</h1>
        {description ? <div className="discret">{description}</div> : null}
      </div>
      {synthese}
    </div>
  );
}

/** Carte contenant une grille de saisie. */
export function BlocGrille({
  titre,
  aide,
  actions,
  children,
}: {
  titre: string;
  aide?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="carte">
      <header>
        <div>
          <h2>{titre}</h2>
          {aide ? <div className="discret">{aide}</div> : null}
        </div>
        {actions}
      </header>
      <div className="corps">{children}</div>
    </section>
  );
}

/** Construit une colonne par exercice à partir d'un rendu de cellule. */
export function colonnesParExercice<T>(
  annees: readonly string[],
  rendu: (ligne: T, exercice: number) => ReactNode,
  total?: (ligne: T, exercice: number) => number,
  largeur = 104,
): Array<Colonne<T>> {
  return annees.map((annee, i) => ({
    cle: `ex${i}`,
    entete: annee,
    largeur,
    rendu: (ligne) => rendu(ligne, i),
    total: total ? (ligne) => total(ligne, i) : undefined,
  }));
}

/** Rangée d'indicateurs de synthèse en tête d'écran. */
export function RangeeIndicateurs({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {children}
    </div>
  );
}

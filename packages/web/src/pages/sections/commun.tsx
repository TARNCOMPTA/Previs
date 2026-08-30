import type { CheminListe, Dossier, Exercice, Resultats } from '@previs/core';
import type { ReactNode } from 'react';
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
 */
export function AvecDossier({ enfant }: { enfant: (ctx: ContexteSection) => ReactNode }) {
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

  if (!dossier || !resultats) return <Chargement />;

  return (
    <>
      {enfant({
        dossier,
        resultats,
        exercices: resultats.exercices,
        annees: resultats.exercices.map((e) => e.libelle),
        modifier,
        ajouterLigne,
        modifierLigne,
        supprimerLigne,
        dupliquerLigne,
        deplacerLigne,
      })}
    </>
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

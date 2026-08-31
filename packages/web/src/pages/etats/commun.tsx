import type { Resultats } from '@previs/core';
import { createContext, useContext, type ReactNode } from 'react';
import { useDossier } from '../../store/dossier.js';
import { Chargement } from '../../ui/divers.js';

/**
 * Renseigné quand l'état est rendu dans le volet de droite de la vue scindée.
 *
 * Deux usages. Le volet porte déjà le nom de l'état dans son sélecteur : y répéter le titre
 * et son chapeau prendrait deux lignes d'une hauteur qu'on préfère donner aux chiffres. Et
 * un état qui renvoie vers un autre état — les orientations des contrôles — doit changer le
 * contenu du volet, non quitter la vue scindée au moment précis où l'on venait corriger.
 */
interface Volet {
  /** Ouvre un autre état dans le volet, sans changer de route. */
  changerResultat: (chemin: string) => void;
}

const ContexteVolet = createContext<Volet | null>(null);

/** Marque le sous-arbre comme rendu dans un volet. */
export function EnVolet({ volet, children }: { volet: Volet; children: ReactNode }) {
  return <ContexteVolet.Provider value={volet}>{children}</ContexteVolet.Provider>;
}

/** Le volet qui porte cet état, ou « null » si l'écran est en pleine largeur. */
export function useVolet(): Volet | null {
  return useContext(ContexteVolet);
}

/** Enveloppe des écrans d'états financiers, tous en lecture seule. */
export function AvecResultats({
  titre,
  description,
  enfant,
}: {
  titre: string;
  description?: string;
  enfant: (r: Resultats, annees: string[]) => ReactNode;
}) {
  const resultats = useDossier((e) => e.resultats);
  const enVolet = useContext(ContexteVolet) !== null;
  if (!resultats) return <Chargement />;
  const annees = resultats.exercices.map((e) => e.libelle);

  return (
    <div className="pile">
      {enVolet ? null : (
        <div>
          <h1>{titre}</h1>
          {description ? <div className="discret">{description}</div> : null}
        </div>
      )}
      {enfant(resultats, annees)}
    </div>
  );
}

/** Carte contenant un état. */
export function BlocEtat({ titre, aide, children }: { titre: string; aide?: string; children: ReactNode }) {
  return (
    <section className="carte">
      <header>
        <div>
          <h2>{titre}</h2>
          {aide ? <div className="discret">{aide}</div> : null}
        </div>
      </header>
      <div className="corps">{children}</div>
    </section>
  );
}

import type { Resultats } from '@previs/core';
import type { ReactNode } from 'react';
import { useDossier } from '../../store/dossier.js';
import { Chargement } from '../../ui/divers.js';

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
  if (!resultats) return <Chargement />;
  const annees = resultats.exercices.map((e) => e.libelle);

  return (
    <div className="pile">
      <div>
        <h1>{titre}</h1>
        {description ? <div className="discret">{description}</div> : null}
      </div>
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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Deux volets côte à côte, séparés par une poignée déplaçable.
 *
 * Le point délicat est le coût du déplacement. Faire suivre la largeur par un état React
 * ferait rerendre les deux volets à chaque pixel de souris — et le volet de gauche est un
 * écran de saisie de plusieurs centaines de lignes. Pendant le glissement, la largeur est
 * donc écrite directement dans une variable CSS du conteneur : le navigateur remet en page,
 * React ne fait rien. L'état n'est mis à jour qu'au relâchement, une seule fois, pour la
 * mémorisation et pour « aria-valuenow ».
 *
 * Le volet de droite porte la largeur fixe et celui de gauche prend le reste : c'est
 * l'inverse de l'intuition, mais c'est le volet de droite dont la largeur utile est connue
 * — un tableau d'état a une largeur minimale mesurable, une grille de saisie non.
 */
export function DeuxVolets({
  gauche,
  droite,
  cle,
  largeurDroiteParDefaut = 560,
  minGauche = 520,
  minDroite = 400,
}: {
  gauche: ReactNode;
  droite: ReactNode;
  /** Clé de mémorisation de la largeur dans le stockage local. */
  cle: string;
  largeurDroiteParDefaut?: number;
  minGauche?: number;
  /** 400 px : le plus étroit des tableaux d'état, le bilan, en demande 403 mesurés. */
  minDroite?: number;
}) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(() => lireLargeur(cle, largeurDroiteParDefaut));
  const [glisse, setGlisse] = useState(false);

  /** Borne la largeur du volet droit à ce que le conteneur peut réellement offrir. */
  const borner = useCallback(
    (valeur: number): number => {
      const total = conteneur.current?.clientWidth ?? 0;
      if (!total) return Math.max(minDroite, valeur);
      const maximum = Math.max(minDroite, total - minGauche - LARGEUR_POIGNEE);
      return Math.min(maximum, Math.max(minDroite, valeur));
    },
    [minDroite, minGauche],
  );

  // Le conteneur peut rétrécir sans qu'on ait touché à la poignée : fenêtre redimensionnée,
  // navigation latérale repliée. Sans cela, le volet de saisie passerait sous son minimum.
  useEffect(() => {
    const element = conteneur.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observateur = new ResizeObserver(() => {
      setLargeur((precedente) => {
        const bornee = borner(precedente);
        return bornee === precedente ? precedente : bornee;
      });
    });
    observateur.observe(element);
    return () => observateur.disconnect();
  }, [borner]);

  const deplacer = (evenement: React.PointerEvent<HTMLDivElement>) => {
    const element = conteneur.current;
    if (!element) return;
    evenement.preventDefault();
    const poignee = evenement.currentTarget;
    poignee.setPointerCapture(evenement.pointerId);
    setGlisse(true);

    const bord = element.getBoundingClientRect().right;
    let derniere = largeur;

    const surDeplacement = (e: PointerEvent) => {
      derniere = borner(bord - e.clientX);
      // Écriture directe : aucun rendu React pendant le glissement.
      element.style.setProperty('--largeur-volet-droit', `${derniere}px`);
    };
    const surRelachement = () => {
      poignee.removeEventListener('pointermove', surDeplacement);
      poignee.removeEventListener('pointerup', surRelachement);
      poignee.removeEventListener('pointercancel', surRelachement);
      setGlisse(false);
      setLargeur(derniere);
      ecrireLargeur(cle, derniere);
    };
    poignee.addEventListener('pointermove', surDeplacement);
    poignee.addEventListener('pointerup', surRelachement);
    poignee.addEventListener('pointercancel', surRelachement);
  };

  /** Au clavier : la poignée se déplace par pas de vingt-quatre pixels. */
  const surTouche = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const pas = e.shiftKey ? 96 : 24;
    let valeur: number | null = null;
    if (e.key === 'ArrowLeft') valeur = largeur + pas;
    else if (e.key === 'ArrowRight') valeur = largeur - pas;
    else if (e.key === 'Home') valeur = minDroite;
    else if (e.key === 'End') valeur = Number.MAX_SAFE_INTEGER;
    else if (e.key === 'Enter') valeur = largeurDroiteParDefaut;
    if (valeur === null) return;
    e.preventDefault();
    const bornee = borner(valeur);
    setLargeur(bornee);
    ecrireLargeur(cle, bornee);
  };

  return (
    <div
      ref={conteneur}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        // La largeur du volet droit vit ici : la poignée l'écrit sans passer par React.
        ['--largeur-volet-droit' as string]: `${largeur}px`,
        // Pendant le glissement, empêche la sélection de texte sous le curseur.
        userSelect: glisse ? 'none' : undefined,
        cursor: glisse ? 'col-resize' : undefined,
      }}
    >
      <div className="volet volet-gauche">{gauche}</div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur du volet de résultat"
        aria-valuenow={Math.round(largeur)}
        aria-valuemin={minDroite}
        tabIndex={0}
        onPointerDown={deplacer}
        onKeyDown={surTouche}
        onDoubleClick={() => {
          const bornee = borner(largeurDroiteParDefaut);
          setLargeur(bornee);
          ecrireLargeur(cle, bornee);
        }}
        title="Glisser pour redimensionner · double-clic pour revenir à la largeur par défaut · flèches au clavier"
        className={`poignee-volets sans-impression${glisse ? ' active' : ''}`}
      />

      <div className="volet volet-droit">{droite}</div>
    </div>
  );
}

/** Largeur de la poignée, en pixels. Doit valoir celle de « .poignee-volets » du thème. */
const LARGEUR_POIGNEE = 7;

function lireLargeur(cle: string, defaut: number): number {
  try {
    const brut = window.localStorage.getItem(cle);
    const valeur = brut === null ? NaN : Number(brut);
    return Number.isFinite(valeur) && valeur > 0 ? valeur : defaut;
  } catch {
    // Navigation privée, stockage refusé : la largeur par défaut fait l'affaire.
    return defaut;
  }
}

function ecrireLargeur(cle: string, valeur: number): void {
  try {
    window.localStorage.setItem(cle, String(Math.round(valeur)));
  } catch {
    // Rien à faire : la largeur reste celle de la session en cours.
  }
}

import { Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { EnVolet } from '../pages/etats/commun.js';
import { Chargement } from '../ui/divers.js';
import { ETATS, etatParChemin } from './ecrans.js';

/**
 * Le volet de droite : un état financier, choisi par l'utilisateur, recalculé à la frappe.
 *
 * Il ne rend pas l'état par le routeur mais directement, parce que la route porte déjà
 * l'écran de saisie du volet de gauche. L'état choisi voyage dans la chaîne de requête
 * (« ?resultat=bilan ») : un lien partagé rouvre ainsi la même paire d'écrans.
 */
export function VoletResultat({
  chemin,
  onChanger,
  dossierId,
}: {
  chemin: string;
  onChanger: (chemin: string) => void;
  dossierId: string;
}) {
  const naviguer = useNavigate();
  const etat = etatParChemin(chemin) ?? ETATS[0];
  const Composant = etat.composant;

  return (
    <>
      <div className="tete-volet sans-impression">
        <label className="discret" htmlFor="volet-resultat">
          Résultat
        </label>
        <select
          id="volet-resultat"
          value={etat.chemin}
          onChange={(e) => onChanger(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          {ETATS.map((e) => (
            <option key={e.chemin} value={e.chemin}>
              {e.libelle}
            </option>
          ))}
        </select>
        <button
          className="bouton discret petit"
          onClick={() => naviguer(`/dossiers/${dossierId}/etats/${etat.chemin}`)}
          title="Ouvrir cet état en pleine largeur"
        >
          ⤢
        </button>
      </div>

      {/*
        La clé force le remontage à chaque changement d'état : sans elle, React réutiliserait
        l'état local du composant précédent — une case cochée, un tri — sous un autre tableau.
      */}
      <Suspense fallback={<Chargement />}>
        <EnVolet volet={{ changerResultat: onChanger }}>
          <Composant key={etat.chemin} />
        </EnVolet>
      </Suspense>
    </>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Chargement } from './ui/divers.js';
import { CoquilleDossier } from './layout/CoquilleDossier.js';
import { Administration } from './pages/Administration.js';
import { Compte } from './pages/Compte.js';
import { Connexion } from './pages/Connexion.js';
import { ListeDossiers } from './pages/ListeDossiers.js';
import { TableauDeBord } from './pages/TableauDeBord.js';
import { useSession } from './store/session.js';

const Investissements = lazy(() => import('./pages/sections/Investissements.js'));
const Financements = lazy(() => import('./pages/sections/Financements.js'));
const Charges = lazy(() => import('./pages/sections/Charges.js'));
const Recettes = lazy(() => import('./pages/sections/Recettes.js'));
const Autres = lazy(() => import('./pages/sections/Autres.js'));

const CompteResultat = lazy(() => import('./pages/etats/CompteResultat.js'));
const Sig = lazy(() => import('./pages/etats/Sig.js'));
const Tresorerie = lazy(() => import('./pages/etats/Tresorerie.js'));
const PlanFinancement = lazy(() => import('./pages/etats/PlanFinancement.js'));
const Bilan = lazy(() => import('./pages/etats/Bilan.js'));
const Tva = lazy(() => import('./pages/etats/Tva.js'));
const Ratios = lazy(() => import('./pages/etats/Ratios.js'));
const Controles = lazy(() => import('./pages/etats/Controles.js'));

export function App() {
  const { utilisateur, chargement, verifier } = useSession();
  const emplacement = useLocation();

  useEffect(() => {
    void verifier();
  }, [verifier]);

  if (chargement) return <Chargement texte="Ouverture de Previs…" />;

  if (!utilisateur) {
    return (
      <Routes>
        <Route path="/connexion" element={<Connexion />} />
        <Route
          path="*"
          element={<Navigate to="/connexion" replace state={{ retour: emplacement.pathname }} />}
        />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<Chargement />}>
      <Routes>
        <Route path="/connexion" element={<Navigate to="/" replace />} />
        <Route path="/" element={<ListeDossiers />} />
        <Route path="/administration" element={<Administration />} />
        <Route path="/compte" element={<Compte />} />

        <Route path="/dossiers/:id" element={<CoquilleDossier />}>
          <Route index element={<Navigate to="tableau-de-bord" replace />} />
          <Route path="tableau-de-bord" element={<TableauDeBord />} />
          <Route path="investissements" element={<Investissements />} />
          <Route path="financements" element={<Financements />} />
          <Route path="charges" element={<Charges />} />
          <Route path="recettes" element={<Recettes />} />
          <Route path="autres" element={<Autres />} />
          <Route path="etats/compte-resultat" element={<CompteResultat />} />
          <Route path="etats/sig" element={<Sig />} />
          <Route path="etats/tresorerie" element={<Tresorerie />} />
          <Route path="etats/plan-financement" element={<PlanFinancement />} />
          <Route path="etats/bilan" element={<Bilan />} />
          <Route path="etats/tva" element={<Tva />} />
          <Route path="etats/ratios" element={<Ratios />} />
          <Route path="etats/controles" element={<Controles />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

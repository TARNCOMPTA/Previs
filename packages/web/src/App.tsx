import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Chargement } from './ui/divers.js';
import { CoquilleDossier } from './layout/CoquilleDossier.js';
import { ETATS, SECTIONS } from './layout/ecrans.js';
import { Administration } from './pages/Administration.js';
import { Compte } from './pages/Compte.js';
import { Connexion } from './pages/Connexion.js';
import { ListeDossiers } from './pages/ListeDossiers.js';
import { useSession } from './store/session.js';

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

        {/* Les routes d'un dossier viennent du registre des écrans : une seule liste. */}
        <Route path="/dossiers/:id" element={<CoquilleDossier />}>
          <Route index element={<Navigate to="tableau-de-bord" replace />} />
          {SECTIONS.map((s) => (
            <Route key={s.chemin} path={s.chemin} element={<s.composant />} />
          ))}
          {ETATS.map((e) => (
            <Route key={e.chemin} path={`etats/${e.chemin}`} element={<e.composant />} />
          ))}
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

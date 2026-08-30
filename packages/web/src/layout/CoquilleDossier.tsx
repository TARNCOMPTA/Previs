import { formaterEuros, formaterMontant, LIBELLES_REGIME } from '@previs/core';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDossier } from '../store/dossier.js';
import { useSession } from '../store/session.js';
import { Bandeau, Chargement, Modale } from '../ui/divers.js';

const SECTIONS = [
  { chemin: 'tableau-de-bord', libelle: 'Tableau de bord' },
  { chemin: 'investissements', libelle: 'Investissement' },
  { chemin: 'financements', libelle: 'Financement' },
  { chemin: 'charges', libelle: 'Charges' },
  { chemin: 'recettes', libelle: 'Recettes' },
  { chemin: 'autres', libelle: 'Autres' },
];

const ETATS = [
  { chemin: 'etats/compte-resultat', libelle: 'Compte de résultat' },
  { chemin: 'etats/sig', libelle: 'Soldes de gestion' },
  { chemin: 'etats/tresorerie', libelle: 'Trésorerie' },
  { chemin: 'etats/plan-financement', libelle: 'Plan de financement' },
  { chemin: 'etats/bilan', libelle: 'Bilan et BFR' },
  { chemin: 'etats/tva', libelle: 'TVA' },
  { chemin: 'etats/ratios', libelle: 'Ratios et seuil' },
  { chemin: 'etats/controles', libelle: 'Contrôles' },
];

/** Libellé de l'état d'enregistrement affiché en permanence dans l'en-tête. */
function libelleEtat(etat: string): { texte: string; ton: 'neutre' | 'attente' | 'erreur' } {
  switch (etat) {
    case 'a_jour':
      return { texte: 'Enregistré', ton: 'neutre' };
    case 'modifie':
      return { texte: 'Modifications en attente', ton: 'attente' };
    case 'enregistrement':
      return { texte: 'Enregistrement…', ton: 'attente' };
    case 'conflit':
      return { texte: 'Conflit de version', ton: 'erreur' };
    default:
      return { texte: 'Erreur d’enregistrement', ton: 'erreur' };
  }
}

/**
 * Coquille d'un dossier : navigation, en-tête d'état et barre d'indicateurs.
 *
 * La barre de pied affiche en permanence les quatre chiffres qui comptent, recalculés
 * à chaque frappe : c'est ce qui permet de voir l'effet d'une saisie sans changer d'écran.
 */
export function CoquilleDossier() {
  const { id } = useParams<{ id: string }>();
  const naviguer = useNavigate();
  const { theme, basculerTheme, utilisateur, deconnecter } = useSession();
  const {
    fiche,
    dossier,
    resultats,
    etat,
    messageErreur,
    misAJourAilleurs,
    chargement,
    erreurCalcul,
    ouvrir,
    fermer,
    recharger,
    enregistrer,
    annuler,
    retablir,
    pileAnnulation,
    pileRetablissement,
  } = useDossier();

  const [exportEnCours, setExportEnCours] = useState(false);
  const [erreurExport, setErreurExport] = useState<string | null>(null);
  const [versionsOuvertes, setVersionsOuvertes] = useState(false);

  useEffect(() => {
    if (id) void ouvrir(id);
    return () => fermer();
  }, [id, ouvrir, fermer]);

  // Raccourcis clavier : annulation, rétablissement et enregistrement immédiat.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        annuler();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        retablir();
      } else if (e.key === 's') {
        e.preventDefault();
        void enregistrer();
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [annuler, retablir, enregistrer]);

  if (chargement || !fiche || !dossier) return <Chargement texte="Ouverture du dossier…" />;

  const statut = libelleEtat(etat);
  const coherent = resultats?.coherent ?? true;
  const nbErreurs = resultats?.controles.filter((c) => !c.ok && c.gravite === 'erreur').length ?? 0;
  const dernier = (resultats?.exercices.length ?? 1) - 1;

  const exporter = async () => {
    setExportEnCours(true);
    setErreurExport(null);
    try {
      await enregistrer();
      await api.telechargerPdf(
        fiche.id,
        `${(fiche.client || fiche.nom).replace(/[^\w-]+/g, '-')}-${fiche.anneeDebut}-Previsionnel.pdf`,
      );
    } catch (e) {
      setErreurExport(e instanceof Error ? e.message : 'Export impossible.');
    } finally {
      setExportEnCours(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* ─── En-tête ─────────────────────────────────────────────────────── */}
      <header
        className="rangee sans-impression"
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--trait)',
          background: 'var(--surface)',
          gap: 14,
        }}
      >
        <button className="bouton discret" onClick={() => naviguer('/')} title="Retour à la liste">
          ←
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fiche.client || fiche.nom}
          </div>
          <div className="discret" style={{ whiteSpace: 'nowrap' }}>
            {LIBELLES_REGIME[dossier.identite.regime]} ·{' '}
            {resultats?.exercices.map((e) => e.libelle).join(' · ')}
          </div>
        </div>

        <div className="separateur" />

        <span
          className="discret"
          style={{ color: statut.ton === 'erreur' ? 'var(--erreur)' : undefined }}
          title={`Version ${fiche.version}`}
        >
          {statut.texte}
        </span>

        <button className="bouton discret" onClick={annuler} disabled={pileAnnulation.length === 0} title="Annuler (Ctrl+Z)">
          ↶
        </button>
        <button
          className="bouton discret"
          onClick={retablir}
          disabled={pileRetablissement.length === 0}
          title="Rétablir (Ctrl+Maj+Z)"
        >
          ↷
        </button>

        <NavLink
          to={`/dossiers/${fiche.id}/etats/controles`}
          className="badge"
          style={{ textDecoration: 'none' }}
          title={coherent ? 'Tous les contrôles sont validés' : `${nbErreurs} contrôle(s) en erreur`}
        >
          <span className={`pastille ${coherent ? 'succes' : 'erreur'}`} />
          {coherent ? 'Cohérent' : `${nbErreurs} écart(s)`}
        </NavLink>

        <button className="bouton discret" onClick={() => setVersionsOuvertes(true)} title="Historique des versions">
          Historique
        </button>
        <button className="bouton principal" onClick={() => void exporter()} disabled={exportEnCours}>
          {exportEnCours ? 'Génération…' : 'Exporter le dossier'}
        </button>
        <button className="bouton discret" onClick={basculerTheme} title="Changer de thème">
          {theme === 'clair' ? '◐' : '◑'}
        </button>
        <button
          className="bouton discret"
          onClick={() => void deconnecter()}
          title={`${utilisateur?.nom} — se déconnecter`}
        >
          ⏻
        </button>
      </header>

      {/* ─── Corps ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav
          className="sans-impression"
          style={{
            width: 208,
            flex: 'none',
            borderRight: '1px solid var(--trait)',
            background: 'var(--surface)',
            padding: '12px 8px',
            overflowY: 'auto',
          }}
        >
          <div className="libelle" style={{ padding: '0 8px' }}>
            Saisie
          </div>
          {SECTIONS.map((s) => (
            <LienNavigation key={s.chemin} to={`/dossiers/${fiche.id}/${s.chemin}`} libelle={s.libelle} />
          ))}
          <div className="libelle" style={{ padding: '14px 8px 0' }}>
            États financiers
          </div>
          {ETATS.map((s) => (
            <LienNavigation key={s.chemin} to={`/dossiers/${fiche.id}/${s.chemin}`} libelle={s.libelle} />
          ))}
        </nav>

        <main style={{ flex: 1, overflowY: 'auto', padding: 18, minWidth: 0 }}>
          <div className="pile" style={{ maxWidth: 1180, margin: '0 auto' }}>
            {misAJourAilleurs ? (
              <Bandeau ton="llm">
                Ce dossier vient d’être mis à jour par l’assistant. Les lignes concernées sont
                signalées par un liseré violet.
              </Bandeau>
            ) : null}

            {etat === 'conflit' ? (
              <Bandeau
                ton="alerte"
                action={
                  <button className="bouton petit" onClick={() => void recharger()}>
                    Recharger
                  </button>
                }
              >
                {messageErreur}
              </Bandeau>
            ) : null}

            {etat === 'erreur' && messageErreur ? <Bandeau ton="erreur">{messageErreur}</Bandeau> : null}
            {erreurCalcul ? (
              <Bandeau ton="erreur">
                Le calcul a échoué : {erreurCalcul}. Les derniers résultats valides restent affichés.
              </Bandeau>
            ) : null}
            {erreurExport ? <Bandeau ton="erreur">{erreurExport}</Bandeau> : null}

            <Outlet />
          </div>
        </main>
      </div>

      {/* ─── Indicateurs permanents ──────────────────────────────────────── */}
      <footer
        className="rangee sans-impression"
        style={{
          gap: 24,
          padding: '7px 18px',
          borderTop: '1px solid var(--trait)',
          background: 'var(--surface)',
          fontSize: 12,
        }}
      >
        <Indicateur
          libelle={`Chiffre d’affaires ${resultats?.exercices[dernier]?.libelle ?? ''}`}
          valeur={formaterEuros(resultats?.compteResultat[dernier]?.chiffreAffaires ?? 0)}
        />
        <Indicateur
          libelle="Résultat net"
          valeur={formaterEuros(resultats?.compteResultat[dernier]?.resultatNet ?? 0)}
          alerte={(resultats?.compteResultat[dernier]?.resultatNet ?? 0) < 0}
        />
        <Indicateur
          libelle="Trésorerie la plus basse"
          valeur={formaterEuros(resultats?.tresorerie.soldeMinimum ?? 0)}
          alerte={(resultats?.tresorerie.soldeMinimum ?? 0) < 0}
        />
        <Indicateur
          libelle="Écart de bilan"
          valeur={formaterMontant(
            Math.max(...(resultats?.bilans.map((b) => Math.abs(b.ecart)) ?? [0])),
          )}
          alerte={(resultats?.bilans.some((b) => Math.abs(b.ecart) > 1) ?? false)}
        />
        <div className="separateur" />
        <span className="discret">Version {fiche.version} · modifié par {fiche.modifiePar}</span>
      </footer>

      {versionsOuvertes ? (
        <HistoriqueVersions dossierId={fiche.id} onFermer={() => setVersionsOuvertes(false)} />
      ) : null}
    </div>
  );
}

function LienNavigation({ to, libelle }: { to: string; libelle: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        padding: '6px 10px',
        borderRadius: 'var(--rayon)',
        marginTop: 1,
        color: isActive ? 'var(--bleu)' : 'var(--texte-doux)',
        background: isActive ? 'var(--bleu-clair)' : 'transparent',
        fontWeight: isActive ? 600 : 400,
        textDecoration: 'none',
      })}
    >
      {libelle}
    </NavLink>
  );
}

function Indicateur({ libelle, valeur, alerte }: { libelle: string; valeur: string; alerte?: boolean }) {
  return (
    <span className="rangee" style={{ gap: 6 }}>
      <span className="discret">{libelle}</span>
      <strong className="nombres" style={{ color: alerte ? 'var(--erreur)' : undefined }}>
        {valeur}
      </strong>
    </span>
  );
}

/** Historique des versions, avec restauration. L'origine distingue l'assistant du clavier. */
function HistoriqueVersions({ dossierId, onFermer }: { dossierId: string; onFermer: () => void }) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof api.versions>> | null>(null);
  const recharger = useDossier((e) => e.recharger);

  useEffect(() => {
    void api.versions(dossierId).then(setVersions).catch(() => setVersions([]));
  }, [dossierId]);

  return (
    <Modale titre="Historique des versions" onFermer={onFermer} largeur={720}>
      {!versions ? (
        <Chargement />
      ) : (
        <table className="etat">
          <thead>
            <tr>
              <th>Version</th>
              <th>Date</th>
              <th>Auteur</th>
              <th>Origine</th>
              <th>Commentaire</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td style={{ textAlign: 'left' }}>{v.version}</td>
                <td>{new Date(v.creeLe).toLocaleString('fr-FR')}</td>
                <td>{v.auteur}</td>
                <td>
                  <span className={`badge ${v.origine === 'mcp' ? 'llm' : ''}`}>
                    {v.origine === 'mcp' ? 'Assistant' : 'Interface'}
                  </span>
                </td>
                <td style={{ textAlign: 'left' }}>{v.commentaire}</td>
                <td>
                  <button
                    className="bouton petit"
                    onClick={async () => {
                      await api.restaurerVersion(dossierId, v.version);
                      await recharger();
                      onFermer();
                    }}
                  >
                    Restaurer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modale>
  );
}

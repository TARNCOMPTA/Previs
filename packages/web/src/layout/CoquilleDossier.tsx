import { formaterEuros, formaterMontant, LIBELLES_REGIME } from '@previs/core';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { api } from '../api/client.js';
import { useDossier } from '../store/dossier.js';
import { useSession } from '../store/session.js';
import { Bandeau, Chargement, Modale } from '../ui/divers.js';
import { DeuxVolets } from '../ui/volets.js';
import { ETATS, SECTIONS, etatLie, sectionParChemin } from './ecrans.js';
import { VoletResultat } from './VoletResultat.js';

/** Clés de mémorisation dans le stockage local. */
const CLE_MODE = 'previs.vue-scindee';
const CLE_LARGEUR = 'previs.largeur-volet-resultat';

/**
 * Largeur en deçà de laquelle deux volets ne tiennent pas.
 *
 * Mesuré, non supposé : le tableau d'état le plus étroit demande 400 px et la grille de
 * saisie la plus modeste 520 px, poignée comprise. Sous 1180 px la vue scindée se replie
 * donc sur un seul écran, et le bouton de bascule le dit.
 */
const LARGEUR_MINIMALE_SCISSION = 1180;

/**
 * Largeur en deçà de laquelle la navigation latérale cède la place à une barre d'onglets.
 *
 * Ses 208 px fixes prenaient plus de la moitié d'un écran de téléphone, pour un contenu qui
 * tient dans une barre horizontale. Le seuil est plus bas que celui de la vue scindée : une
 * fenêtre de 900 px n'a pas la place des deux volets, mais elle a celle de la colonne.
 */
const LARGEUR_MINIMALE_NAVIGATION = 860;

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

  // ─── Vue scindée ──────────────────────────────────────────────────────────
  const emplacement = useLocation();
  const [requete, setRequete] = useSearchParams();
  const [scissionVoulue, setScissionVoulue] = useState(lirePreference);
  const [assezLarge, setAssezLarge] = useState(fenetreAssezLarge);
  const [navLaterale, setNavLaterale] = useState(fenetreAssezLargePourNav);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${LARGEUR_MINIMALE_SCISSION}px)`);
    const surChangement = () => {
      // Franchir le seuil démonte un volet : la frappe en cours doit être validée avant.
      validerLaFrappeEnCours();
      setAssezLarge(media.matches);
    };
    media.addEventListener('change', surChangement);
    return () => media.removeEventListener('change', surChangement);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${LARGEUR_MINIMALE_NAVIGATION}px)`);
    const surChangement = () => {
      // Même raison : passer de la colonne à la barre d'onglets démonte l'écran courant.
      validerLaFrappeEnCours();
      setNavLaterale(media.matches);
    };
    media.addEventListener('change', surChangement);
    return () => media.removeEventListener('change', surChangement);
  }, []);

  /** Le dernier segment de l'URL, qui dit quel écran est ouvert. */
  const segment = emplacement.pathname.split('/').filter(Boolean).pop() ?? '';
  const sectionCourante = sectionParChemin(segment);
  /*
   * Un état ouvert depuis la navigation latérale s'affiche en pleine largeur : c'est le
   * volet de gauche qui porte la saisie, et il n'y a rien à saisir sur un état.
   */
  const scinde = Boolean(scissionVoulue && assezLarge && sectionCourante);
  const resultatDroite = requete.get('resultat') ?? etatLie(segment);

  const changerResultat = (chemin: string) => {
    const suivante = new URLSearchParams(requete);
    suivante.set('resultat', chemin);
    // « replace » : changer de tableau à droite n'est pas une étape de navigation.
    setRequete(suivante, { replace: true });
  };

  const basculerScission = () => {
    validerLaFrappeEnCours();
    const suivant = !scissionVoulue;
    setScissionVoulue(suivant);
    ecrirePreference(suivant);
    // Scinder depuis un état garde cet état à droite et rouvre la saisie à gauche.
    if (suivant && !sectionCourante) {
      const etatOuvert = ETATS.find((e) => e.chemin === segment)?.chemin;
      naviguer({
        pathname: `/dossiers/${id}/tableau-de-bord`,
        search: etatOuvert ? `?resultat=${etatOuvert}` : '',
      });
    }
  };

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

  /**
   * Les bandeaux d'avertissement, montés une seule fois.
   *
   * Ils étaient auparavant dans le corps de « main ». En vue scindée il n'y a plus un
   * « main » mais deux volets, et un bandeau de conflit de version ne concerne ni l'un ni
   * l'autre : il concerne le dossier.
   */
  const bandeaux = [
    misAJourAilleurs ? (
      <Bandeau key="ailleurs" ton="llm">
        Ce dossier vient d’être mis à jour par l’assistant. Les lignes concernées sont
        signalées par un liseré violet.
      </Bandeau>
    ) : null,
    etat === 'conflit' ? (
      <Bandeau
        key="conflit"
        ton="alerte"
        action={
          <button className="bouton petit" onClick={() => void recharger()}>
            Recharger
          </button>
        }
      >
        {messageErreur}
      </Bandeau>
    ) : null,
    etat === 'erreur' && messageErreur ? (
      <Bandeau key="erreur" ton="erreur">
        {messageErreur}
      </Bandeau>
    ) : null,
    erreurCalcul ? (
      <Bandeau key="calcul" ton="erreur">
        Le calcul a échoué : {erreurCalcul}. Les derniers résultats valides restent affichés.
      </Bandeau>
    ) : null,
    erreurExport ? (
      <Bandeau key="export" ton="erreur">
        {erreurExport}
      </Bandeau>
    ) : null,
  ].filter(Boolean);

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
    <div className="hauteur-fenetre" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ─── En-tête ─────────────────────────────────────────────────────── */}
      <header
        className="rangee entete-dossier sans-impression"
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

        {/*
         * Les actions forment leur propre rang. Sur un téléphone il défile plutôt que de
         * s'empiler : huit commandes repliées prenaient deux rangs de quarante pixels, et
         * l'en-tête à lui seul mangeait un cinquième de l'écran avant le premier chiffre.
         */}
        <div className="rangee actions-dossier">
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

          {/*
            La bascule ne s'affiche que si la fenêtre peut scinder. Un bouton désactivé en
            permanence est un encombrement sur un téléphone, et il n'y explique rien : la
            largeur ne s'y change pas.
          */}
          {assezLarge ? (
            <button
              className={`bouton ${scinde ? '' : 'discret'}`}
              onClick={basculerScission}
              aria-pressed={scinde}
              title={scinde ? 'Revenir à un seul écran' : 'Afficher la saisie et le résultat côte à côte'}
            >
              {scinde ? '▮▮' : '▮'}
            </button>
          ) : null}

          <button className="bouton discret" onClick={() => setVersionsOuvertes(true)} title="Historique des versions">
            {/* Deux libellés, un seul visible : couper le mot en deux enfants ferait jouer
                le « gap » du bouton entre eux, et l'on lisait « Histo rique ». */}
            <span className="sur-grand-ecran">Historique</span>
            {/* « Versions » plutôt qu'« Histo » : un mot entier, qui dit la même chose. */}
            <span className="sur-petit-ecran">Versions</span>
          </button>
          <button className="bouton principal" onClick={() => void exporter()} disabled={exportEnCours}>
            {exportEnCours ? (
              'Génération…'
            ) : (
              <>
                <span className="sur-grand-ecran">Exporter le dossier</span>
                <span className="sur-petit-ecran">Exporter</span>
              </>
            )}
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
        </div>

      </header>

      {/* ─── Corps ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/*
          La navigation latérale s'efface en vue scindée : ses 208 px sont ce qui manque aux
          deux volets pour tenir, et chaque volet porte alors son propre sélecteur d'écran.
        */}
        {scinde || !navLaterale ? null : (
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
              <LienNavigation
                key={s.chemin}
                to={`/dossiers/${fiche.id}/etats/${s.chemin}`}
                libelle={s.libelle}
              />
            ))}
          </nav>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          {/*
            Les bandeaux concernent le dossier, non l'un des volets : ils restent au-dessus
            des deux, où ils se voient quel que soit le volet consulté.
          */}
          {bandeaux.length ? (
            <div
              className="pile"
              style={{ padding: scinde ? '12px 18px 0' : '18px 18px 0', gap: 10, flex: 'none' }}
            >
              {bandeaux}
            </div>
          ) : null}

          {scinde ? (
            <DeuxVolets
              cle={CLE_LARGEUR}
              gauche={
                <>
                  <OngletsSaisie dossierId={fiche.id} courant={segment} recherche={emplacement.search} />
                  {/*
                    Une frontière Suspense par volet, et non celle de l'application : sans elle,
                    le premier affichage d'un écran chargé à la demande remplacerait toute la
                    fenêtre par « Chargement… », en-tête et volet de résultat compris.
                  */}
                  <Suspense fallback={<Chargement />}>
                    <Outlet />
                  </Suspense>
                </>
              }
              droite={
                <VoletResultat
                  chemin={resultatDroite}
                  onChanger={changerResultat}
                  dossierId={fiche.id}
                />
              }
            />
          ) : (
            <main style={{ flex: 1, overflowY: 'auto', padding: navLaterale ? 18 : 12, minWidth: 0 }}>
              <div className="pile" style={{ maxWidth: 1180, margin: '0 auto' }}>
                {/*
                  Sans la colonne, il faut bien un moyen d'atteindre les autres écrans : la
                  barre d'onglets de la vue scindée fait l'affaire, augmentée des états.
                */}
                {navLaterale ? null : (
                  <OngletsSaisie
                    dossierId={fiche.id}
                    courant={segment}
                    recherche={emplacement.search}
                    avecEtats
                  />
                )}
                <Outlet />
              </div>
            </main>
          )}
        </div>
      </div>

      {/* ─── Indicateurs permanents ──────────────────────────────────────── */}
      <footer
        className="rangee indicateurs sans-impression"
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
        <span className="discret sur-grand-ecran">
          Version {fiche.version} · modifié par {fiche.modifiePar}
        </span>
      </footer>

      {versionsOuvertes ? (
        <HistoriqueVersions dossierId={fiche.id} onFermer={() => setVersionsOuvertes(false)} />
      ) : null}
    </div>
  );
}

/**
 * Les onglets de saisie, en tête du volet de gauche.
 *
 * Ils remplacent la navigation latérale, effacée en vue scindée. La chaîne de requête est
 * reportée sur chaque lien : changer d'écran de saisie ne doit pas refermer le tableau
 * qu'on avait ouvert à droite.
 */
/**
 * La barre d'onglets de la saisie.
 *
 * `avecEtats` y ajoute les états financiers : c'est ce qui remplace la navigation latérale
 * sur un écran trop étroit pour ses 208 px fixes. En vue scindée, au contraire, les états
 * ont leur propre sélecteur dans le volet de droite et n'ont rien à faire ici.
 */
function OngletsSaisie({
  dossierId,
  courant,
  recherche,
  avecEtats,
}: {
  dossierId: string;
  courant: string;
  recherche: string;
  avecEtats?: boolean;
}) {
  const barre = useRef<HTMLDivElement>(null);

  /*
   * L'onglet actif est amené dans la vue.
   *
   * Sur un téléphone la barre défile, et elle s'ouvre à zéro : ouvrir « Bilan et BFR »
   * montrait une barre commençant à « Bord », sans rien pour dire où l'on se trouve.
   * Le défilement est calculé plutôt que confié à `scrollIntoView`, qui fait aussi défiler
   * la PAGE — on aurait perdu le titre de l'écran à chaque navigation.
   */
  useEffect(() => {
    const conteneur = barre.current;
    const actif = conteneur?.querySelector<HTMLElement>('[data-actif="1"]');
    if (!conteneur || !actif) return;
    const centre = actif.offsetLeft - (conteneur.clientWidth - actif.offsetWidth) / 2;
    conteneur.scrollLeft = Math.max(0, centre);
  }, [courant]);

  return (
    <div
      ref={barre}
      className="rangee onglets-ecrans sans-impression"
      style={{
        gap: 2,
        marginBottom: 14,
        borderBottom: '1px solid var(--trait)',
        paddingBottom: 6,
        flexWrap: 'wrap',
      }}
    >
      {SECTIONS.map((section) => {
        const actif = section.chemin === courant;
        return (
          <NavLink
            key={section.chemin}
            data-actif={actif ? '1' : undefined}
            to={{ pathname: `/dossiers/${dossierId}/${section.chemin}`, search: recherche }}
            style={{
              padding: '5px 10px',
              borderRadius: 'var(--rayon)',
              fontSize: 13,
              fontWeight: actif ? 600 : 400,
              color: actif ? 'var(--bleu)' : 'var(--texte-doux)',
              background: actif ? 'var(--bleu-clair)' : 'transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {section.court ?? section.libelle}
          </NavLink>
        );
      })}

      {avecEtats ? (
        <>
          <span
            aria-hidden
            style={{ width: 1, alignSelf: 'stretch', background: 'var(--trait)', margin: '0 6px' }}
          />
          {ETATS.map((etat) => {
            const actif = etat.chemin === courant;
            return (
              <NavLink
                key={etat.chemin}
                data-actif={actif ? '1' : undefined}
                to={`/dossiers/${dossierId}/etats/${etat.chemin}`}
                style={{
                  padding: '5px 10px',
                  borderRadius: 'var(--rayon)',
                  fontSize: 13,
                  fontWeight: actif ? 600 : 400,
                  color: actif ? 'var(--turquoise)' : 'var(--texte-doux)',
                  background: actif ? 'var(--turquoise-clair)' : 'transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {etat.court ?? etat.libelle}
              </NavLink>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/** La préférence de vue scindée, mémorisée d'une session à l'autre. Scindée par défaut. */
function lirePreference(): boolean {
  try {
    const brut = window.localStorage.getItem(CLE_MODE);
    return brut === null ? true : brut === '1';
  } catch {
    return true;
  }
}

function ecrirePreference(valeur: boolean): void {
  try {
    window.localStorage.setItem(CLE_MODE, valeur ? '1' : '0');
  } catch {
    // Stockage refusé : la préférence ne vaut que pour la session en cours.
  }
}

function fenetreAssezLarge(): boolean {
  return window.matchMedia(`(min-width: ${LARGEUR_MINIMALE_SCISSION}px)`).matches;
}

function fenetreAssezLargePourNav(): boolean {
  return window.matchMedia(`(min-width: ${LARGEUR_MINIMALE_NAVIGATION}px)`).matches;
}

/**
 * Valide la frappe en cours avant tout changement de forme de l'arbre.
 *
 * « ChampMontant » garde sa saisie en état local et ne la remonte qu'au « blur » : un
 * démontage sans blur préalable — bascule du bouton, franchissement du seuil de largeur —
 * ferait revenir le montant à sa valeur précédente, sous les yeux de l'utilisateur et sans
 * rien pour l'expliquer.
 */
function validerLaFrappeEnCours(): void {
  const actif = document.activeElement;
  if (actif instanceof HTMLElement && actif !== document.body) actif.blur();
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

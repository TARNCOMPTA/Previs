import { formaterEuros, LIBELLES_TYPE_DOSSIER, MODELES_DISPONIBLES, type ResumeDossier } from '@previs/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSession } from '../store/session.js';
import { ChampTexte, Selecteur } from '../ui/champs.js';
import { Bandeau, Chargement, Confirmation, Modale, ZoneVide } from '../ui/divers.js';

/** Écran d'accueil : la liste des dossiers du cabinet. */
export function ListeDossiers() {
  const naviguer = useNavigate();
  const { utilisateur, deconnecter, theme, basculerTheme } = useSession();
  const [dossiers, setDossiers] = useState<ResumeDossier[] | null>(null);
  const [recherche, setRecherche] = useState('');
  const [creation, setCreation] = useState(false);
  const [aSupprimer, setASupprimer] = useState<ResumeDossier | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = () =>
    api
      .listerDossiers()
      .then(setDossiers)
      .catch((e) => setErreur(e instanceof Error ? e.message : 'Chargement impossible.'));

  useEffect(() => {
    void charger();
  }, []);

  const visibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (!terme || !dossiers) return dossiers ?? [];
    return dossiers.filter((d) =>
      [d.nom, d.client, d.regime, d.anneeDebut].join(' ').toLowerCase().includes(terme),
    );
  }, [dossiers, recherche]);

  const lectureSeule = utilisateur?.role === 'lecteur';

  return (
    <div className="hauteur-minimale-fenetre">
      <header
        className="rangee"
        style={{
          padding: '10px 18px',
          borderBottom: '1px solid var(--trait)',
          background: 'var(--surface)',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bleu)' }}>Previs</div>
        {/* La signature du cabinet est de l'ornement : elle cède la place sur un téléphone. */}
        <div className="discret sur-grand-ecran">Prévisionnel financier — TARN COMPTA</div>
        <div className="separateur" />
        {/* Même parti que dans la coquille d'un dossier : un rang qui défile plutôt que
            trois rangs empilés, qui prenaient cent soixante pixels avant le premier titre. */}
        <div className="rangee actions-dossier">
        {utilisateur?.role === 'admin' ? (
          <button className="bouton discret" onClick={() => naviguer('/administration')}>
            Administration
          </button>
        ) : null}
        <button
          className="bouton discret"
          onClick={() => naviguer('/compte')}
          title="Mot de passe et clés d’accès"
        >
          {utilisateur?.nom}
        </button>
        <button className="bouton discret" onClick={basculerTheme} title="Changer de thème">
          {theme === 'clair' ? '◐' : '◑'}
        </button>
        <button className="bouton discret" onClick={() => void deconnecter()}>
          Se déconnecter
        </button>
        </div>
      </header>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 20 }} className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

        <div className="rangee espace">
          <h1>Dossiers prévisionnels</h1>
          <div className="rangee" style={{ gap: 8, flex: '1 1 260px', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <input
              className="champ"
              // Une largeur fixe débordait d'un écran de téléphone : le champ prend
              // maintenant la place restante, sans dépasser sa largeur de confort.
              style={{ flex: '1 1 auto', maxWidth: 240, minWidth: 0 }}
              placeholder="Rechercher un dossier…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            <button
              className="bouton principal"
              style={{ flex: 'none', whiteSpace: 'nowrap' }}
              onClick={() => setCreation(true)}
              disabled={lectureSeule}
            >
              <span className="sur-grand-ecran">Nouveau dossier</span>
              <span className="sur-petit-ecran">Nouveau</span>
            </button>
          </div>
        </div>

        {!dossiers ? (
          <Chargement />
        ) : visibles.length === 0 ? (
          <div className="carte">
            <ZoneVide titre={recherche ? 'Aucun dossier ne correspond à cette recherche.' : 'Aucun dossier pour le moment.'}>
              {!recherche && !lectureSeule ? (
                <button className="bouton principal" style={{ marginTop: 10 }} onClick={() => setCreation(true)}>
                  Créer le premier dossier
                </button>
              ) : null}
            </ZoneVide>
          </div>
        ) : (
          <div className="carte">
            <table className="etat">
              <thead>
                <tr>
                  <th>Dossier</th>
                  <th>Client</th>
                  <th className="sur-grand-ecran">Régime</th>
                  <th className="sur-grand-ecran">Type</th>
                  <th className="sur-grand-ecran">Période</th>
                  <th className="sur-grand-ecran">CA du 1ᵉʳ exercice</th>
                  <th className="sur-grand-ecran">Modifié</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.map((d) => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => naviguer(`/dossiers/${d.id}`)}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="rangee" style={{ gap: 7 }}>
                        <span className={`pastille ${d.coherent ? 'succes' : 'erreur'}`} title={d.coherent ? 'Contrôles validés' : 'Contrôles en erreur'} />
                        <strong>{d.nom}</strong>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>{d.client || '—'}</td>
                    <td className="sur-grand-ecran" style={{ textAlign: 'left' }}>{d.regime}</td>
                    <td className="sur-grand-ecran" style={{ textAlign: 'left' }}>
                      {LIBELLES_TYPE_DOSSIER[d.typeDossier as keyof typeof LIBELLES_TYPE_DOSSIER] ?? d.typeDossier}
                    </td>
                    <td className="sur-grand-ecran" style={{ textAlign: 'left' }}>
                      {d.anneeDebut} · {d.nbExercices} ex.
                    </td>
                    <td className="sur-grand-ecran">{formaterEuros(d.caPremierExercice)}</td>
                    <td style={{ textAlign: 'left' }} className="discret sur-grand-ecran">
                      {new Date(d.modifieLe).toLocaleDateString('fr-FR')} — {d.modifiePar}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="rangee" style={{ justifyContent: 'flex-end', gap: 2 }}>
                        <button
                          className="bouton discret petit"
                          title="Dupliquer"
                          disabled={lectureSeule}
                          onClick={() => void api.dupliquerDossier(d.id).then(charger)}
                        >
                          ⧉
                        </button>
                        <button
                          className="bouton discret petit danger"
                          title="Supprimer"
                          disabled={lectureSeule}
                          onClick={() => setASupprimer(d)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creation ? (
        <ModaleCreation
          onFermer={() => setCreation(false)}
          onCree={(id) => naviguer(`/dossiers/${id}`)}
        />
      ) : null}

      {aSupprimer ? (
        <Confirmation
          titre="Supprimer le dossier"
          message={`Le dossier « ${aSupprimer.nom} » et tout son historique seront définitivement supprimés.`}
          libelleAction="Supprimer"
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={async () => {
            await api.supprimerDossier(aSupprimer.id);
            setASupprimer(null);
            await charger();
          }}
        />
      ) : null}
    </div>
  );
}

function ModaleCreation({ onFermer, onCree }: { onFermer: () => void; onCree: (id: string) => void }) {
  const [nom, setNom] = useState('');
  const [modele, setModele] = useState<'vide' | 'IS' | 'BNC' | 'BIC_IR'>('IS');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const cree = await api.creerDossier({ nom: nom.trim(), modele });
      onCree(cree.id);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Création impossible.');
      setEnvoi(false);
    }
  };

  const description = MODELES_DISPONIBLES.find((m) => m.cle === modele)?.description ?? '';

  return (
    <Modale
      titre="Nouveau dossier prévisionnel"
      onFermer={onFermer}
      actions={
        <>
          <button className="bouton" onClick={onFermer}>
            Annuler
          </button>
          <button className="bouton principal" disabled={!nom.trim() || envoi} onClick={() => void creer()}>
            {envoi ? 'Création…' : 'Créer le dossier'}
          </button>
        </>
      }
    >
      <div className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
        <ChampTexte
          libelle="Nom du dossier"
          valeur={nom}
          onChange={setNom}
          placeholder="Raison sociale du client"
        />
        <Selecteur
          libelle="Modèle de départ"
          valeur={modele}
          onChange={setModele}
          options={MODELES_DISPONIBLES.map((m) => ({ valeur: m.cle as typeof modele, libelle: m.libelle }))}
          aide={description}
        />
        <Bandeau>
          Le modèle ne pré-remplit que des libellés de charges usuelles, tous à zéro. Aucun
          montant n’est présumé : les lignes restées à zéro n’apparaîtront pas dans le dossier remis.
        </Bandeau>
      </div>
    </Modale>
  );
}

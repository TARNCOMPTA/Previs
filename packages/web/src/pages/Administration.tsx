import type { AutorisationOauth, JetonApi, Utilisateur } from '@previs/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSession } from '../store/session.js';
import { ChampNombre, ChampTexte, Selecteur } from '../ui/champs.js';
import { Bandeau, Chargement, Confirmation, Modale } from '../ui/divers.js';
import { CarteCabinet } from './CarteCabinet.js';

/** Gestion des comptes du cabinet et des jetons d'API du serveur MCP. */
export function Administration() {
  const naviguer = useNavigate();
  const utilisateurCourant = useSession((e) => e.utilisateur);
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[] | null>(null);
  const [jetons, setJetons] = useState<JetonApi[] | null>(null);
  const [autorisations, setAutorisations] = useState<AutorisationOauth[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creationCompte, setCreationCompte] = useState(false);
  const [creationJeton, setCreationJeton] = useState(false);
  const [jetonEnClair, setJetonEnClair] = useState<{ libelle: string; jeton: string } | null>(null);
  const [aSupprimer, setASupprimer] = useState<{
    type: 'compte' | 'jeton' | 'autorisation';
    id: string;
    nom: string;
    /** Compte visé, pour une autorisation : elle se révoque par couple compte-connecteur. */
    utilisateurId?: string;
  } | null>(null);

  const charger = async () => {
    try {
      const [u, j, a] = await Promise.all([
        api.listerUtilisateurs(),
        api.listerJetons(),
        api.listerAutorisations(),
      ]);
      setUtilisateurs(u);
      setJetons(j);
      setAutorisations(a);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    }
  };

  useEffect(() => {
    void charger();
  }, []);

  if (utilisateurCourant?.role !== 'admin') {
    return (
      <div style={{ padding: 24 }}>
        <Bandeau ton="erreur">Cet écran est réservé aux administrateurs.</Bandeau>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        className="rangee"
        style={{ padding: '10px 18px', borderBottom: '1px solid var(--trait)', background: 'var(--surface)', gap: 12 }}
      >
        <button className="bouton discret" onClick={() => naviguer('/')}>
          ←
        </button>
        <h1>Administration</h1>
      </header>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: 20 }} className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

        <CarteCabinet />

        <section className="carte">
          <header>
            <div>
              <h2>Comptes du cabinet</h2>
              <div className="discret">
                Un lecteur consulte sans pouvoir écrire ; seul un administrateur gère les comptes et les jetons.
              </div>
            </div>
            <button className="bouton principal" onClick={() => setCreationCompte(true)}>
              Nouveau compte
            </button>
          </header>
          <div className="corps">
            {!utilisateurs ? (
              <Chargement />
            ) : (
              <table className="etat">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Adresse</th>
                    <th>Rôle</th>
                    <th>Dernière connexion</th>
                    <th>État</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {utilisateurs.map((u) => (
                    <tr key={u.id}>
                      <td style={{ textAlign: 'left' }}>{u.nom}</td>
                      <td style={{ textAlign: 'left' }}>{u.email}</td>
                      <td style={{ textAlign: 'left' }}>
                        <Selecteur
                          valeur={u.role}
                          onChange={(role) => void api.modifierUtilisateur(u.id, { role }).then(charger)}
                          options={[
                            { valeur: 'admin' as const, libelle: 'Administrateur' },
                            { valeur: 'collaborateur' as const, libelle: 'Collaborateur' },
                            { valeur: 'lecteur' as const, libelle: 'Lecteur' },
                          ]}
                          desactive={u.id === utilisateurCourant.id}
                        />
                      </td>
                      <td style={{ textAlign: 'left' }} className="discret">
                        {u.derniereConnexion ? new Date(u.derniereConnexion).toLocaleString('fr-FR') : 'jamais'}
                      </td>
                      <td>
                        <button
                          className={`badge ${u.actif ? 'succes' : 'erreur'}`}
                          style={{ border: 'none', cursor: 'pointer' }}
                          disabled={u.id === utilisateurCourant.id}
                          onClick={() => void api.modifierUtilisateur(u.id, { actif: !u.actif }).then(charger)}
                        >
                          {u.actif ? 'Actif' : 'Désactivé'}
                        </button>
                      </td>
                      <td>
                        <button
                          className="bouton discret petit danger"
                          disabled={u.id === utilisateurCourant.id}
                          onClick={() => setASupprimer({ type: 'compte', id: u.id, nom: u.nom })}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="carte">
          <header>
            <div>
              <h2>Jetons d’API pour l’assistant</h2>
              <div className="discret">
                Un jeton autorise le serveur MCP à lire et écrire les dossiers. Il n’est affiché
                qu’une seule fois, à sa création.
              </div>
            </div>
            <button className="bouton principal" onClick={() => setCreationJeton(true)}>
              Nouveau jeton
            </button>
          </header>
          <div className="corps">
            {!jetons ? (
              <Chargement />
            ) : jetons.length === 0 ? (
              <div className="zone-vide">Aucun jeton créé.</div>
            ) : (
              <table className="etat">
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th>Aperçu</th>
                    <th>Créé le</th>
                    <th>Expire le</th>
                    <th>Dernière utilisation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {jetons.map((j) => (
                    <tr key={j.id}>
                      <td style={{ textAlign: 'left' }}>{j.libelle}</td>
                      <td className="mono">…{j.apercu}</td>
                      <td>{new Date(j.creeLe).toLocaleDateString('fr-FR')}</td>
                      <td>{j.expireLe ? new Date(j.expireLe).toLocaleDateString('fr-FR') : 'sans expiration'}</td>
                      <td className="discret">
                        {j.derniereUtilisation ? new Date(j.derniereUtilisation).toLocaleString('fr-FR') : 'jamais'}
                      </td>
                      <td>
                        <button
                          className="bouton discret petit danger"
                          onClick={() => setASupprimer({ type: 'jeton', id: j.id, nom: j.libelle })}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="carte">
          <header>
            <div>
              <h2>Connecteurs autorisés</h2>
              <div className="discret">
                Une autorisation accordée depuis Claude — application ou site — vaut jusqu’à sa
                révocation. La révoquer coupe l’accès immédiatement ; le connecteur redemandera le
                consentement à sa prochaine connexion.
              </div>
            </div>
          </header>
          <div className="corps">
            {!autorisations ? (
              <Chargement />
            ) : autorisations.length === 0 ? (
              <div className="zone-vide">Aucun connecteur autorisé.</div>
            ) : (
              <table className="etat">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Application</th>
                    <th style={{ textAlign: 'left' }}>Compte</th>
                    <th>Accordée le</th>
                    <th>Valable jusqu’au</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {autorisations.map((a) => (
                    <tr key={`${a.utilisateurId}:${a.clientId}`}>
                      <td style={{ textAlign: 'left' }}>{a.nomClient || 'Application sans nom'}</td>
                      <td style={{ textAlign: 'left' }}>
                        {a.compte}
                        <div className="discret">{a.courriel}</div>
                      </td>
                      <td>{new Date(a.accordeeLe).toLocaleString('fr-FR')}</td>
                      <td>{new Date(a.expireLe).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <button
                          className="bouton discret petit danger"
                          onClick={() =>
                            setASupprimer({
                              type: 'autorisation',
                              id: a.clientId,
                              nom: `${a.nomClient || 'Application sans nom'} — ${a.compte}`,
                              utilisateurId: a.utilisateurId,
                            })
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {creationCompte ? <ModaleCompte onFermer={() => setCreationCompte(false)} onCree={charger} /> : null}
      {creationJeton ? (
        <ModaleJeton
          onFermer={() => setCreationJeton(false)}
          onCree={async (libelle, jeton) => {
            setJetonEnClair({ libelle, jeton });
            await charger();
          }}
        />
      ) : null}
      {jetonEnClair ? (
        <ModaleJetonCree {...jetonEnClair} onFermer={() => setJetonEnClair(null)} />
      ) : null}
      {aSupprimer ? (
        <Confirmation
          titre={
            aSupprimer.type === 'compte'
              ? 'Supprimer le compte'
              : aSupprimer.type === 'jeton'
                ? 'Révoquer le jeton'
                : 'Révoquer l’autorisation'
          }
          message={
            aSupprimer.type === 'compte'
              ? `Le compte « ${aSupprimer.nom} » sera supprimé et ses sessions fermées.`
              : aSupprimer.type === 'jeton'
                ? `Le jeton « ${aSupprimer.nom} » cessera immédiatement de fonctionner.`
                : `« ${aSupprimer.nom} » perdra l’accès aux dossiers immédiatement.`
          }
          libelleAction={aSupprimer.type === 'compte' ? 'Supprimer' : 'Révoquer'}
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={async () => {
            if (aSupprimer.type === 'compte') await api.supprimerUtilisateur(aSupprimer.id);
            else if (aSupprimer.type === 'jeton') await api.supprimerJeton(aSupprimer.id);
            else await api.revoquerAutorisation(aSupprimer.utilisateurId ?? '', aSupprimer.id);
            setASupprimer(null);
            await charger();
          }}
        />
      ) : null}
    </div>
  );
}

function ModaleCompte({ onFermer, onCree }: { onFermer: () => void; onCree: () => Promise<void> }) {
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [role, setRole] = useState<'admin' | 'collaborateur' | 'lecteur'>('collaborateur');
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <Modale
      titre="Nouveau compte"
      onFermer={onFermer}
      actions={
        <>
          <button className="bouton" onClick={onFermer}>
            Annuler
          </button>
          <button
            className="bouton principal"
            disabled={!nom || !email || motDePasse.length < 10}
            onClick={async () => {
              try {
                await api.creerUtilisateur({ nom, email, motDePasse, role });
                await onCree();
                onFermer();
              } catch (e) {
                setErreur(e instanceof Error ? e.message : 'Création impossible.');
              }
            }}
          >
            Créer le compte
          </button>
        </>
      }
    >
      <div className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
        <ChampTexte libelle="Nom" valeur={nom} onChange={setNom} />
        <ChampTexte libelle="Adresse électronique" valeur={email} onChange={setEmail} />
        <ChampTexte
          libelle="Mot de passe"
          valeur={motDePasse}
          onChange={setMotDePasse}
          aide="Au moins dix caractères. Il sera haché par scrypt et jamais stocké en clair."
        />
        <Selecteur
          libelle="Rôle"
          valeur={role}
          onChange={setRole}
          options={[
            { valeur: 'collaborateur' as const, libelle: 'Collaborateur — saisie et consultation' },
            { valeur: 'lecteur' as const, libelle: 'Lecteur — consultation seule' },
            { valeur: 'admin' as const, libelle: 'Administrateur — gestion des comptes' },
          ]}
        />
      </div>
    </Modale>
  );
}

function ModaleJeton({
  onFermer,
  onCree,
}: {
  onFermer: () => void;
  onCree: (libelle: string, jeton: string) => Promise<void>;
}) {
  const [libelle, setLibelle] = useState('Claude');
  const [validite, setValidite] = useState(365);
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <Modale
      titre="Nouveau jeton d’API"
      onFermer={onFermer}
      actions={
        <>
          <button className="bouton" onClick={onFermer}>
            Annuler
          </button>
          <button
            className="bouton principal"
            disabled={!libelle.trim()}
            onClick={async () => {
              try {
                const cree = await api.creerJeton(libelle.trim(), validite);
                onFermer();
                await onCree(cree.libelle, cree.jeton);
              } catch (e) {
                setErreur(e instanceof Error ? e.message : 'Création impossible.');
              }
            }}
          >
            Créer le jeton
          </button>
        </>
      }
    >
      <div className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
        <ChampTexte libelle="Libellé" valeur={libelle} onChange={setLibelle} placeholder="Claude Desktop" />
        <ChampNombre
          libelle="Validité (jours)"
          valeur={validite}
          min={0}
          max={3650}
          onChange={setValidite}
          aide="0 pour un jeton sans expiration."
        />
      </div>
    </Modale>
  );
}

/** Affichage unique du jeton en clair, avec la configuration à coller dans Claude. */
function ModaleJetonCree({ libelle, jeton, onFermer }: { libelle: string; jeton: string; onFermer: () => void }) {
  // Le serveur MCP n'est pas publié sur npm : il est exécuté depuis l'installation
  // du VPS, ou joint directement en HTTP sur /mcp.
  const configuration = JSON.stringify(
    {
      mcpServers: {
        previs: {
          command: 'node',
          args: ['/opt/previs/packages/mcp/dist/stdio.js'],
          env: { PREVIS_URL: window.location.origin, PREVIS_TOKEN: jeton },
        },
      },
    },
    null,
    2,
  );

  return (
    <Modale
      titre={`Jeton « ${libelle} » créé`}
      onFermer={onFermer}
      largeur={640}
      actions={
        <button className="bouton principal" onClick={onFermer}>
          J’ai noté le jeton
        </button>
      }
    >
      <div className="pile">
        <Bandeau ton="alerte">
          Ce jeton n’est affiché qu’une seule fois. Seule son empreinte est conservée : il ne pourra
          pas être retrouvé ensuite.
        </Bandeau>

        <div>
          <label className="libelle">Jeton</label>
          <div className="rangee" style={{ gap: 6 }}>
            <input className="champ mono" readOnly value={jeton} onFocus={(e) => e.currentTarget.select()} />
            <button className="bouton" onClick={() => void navigator.clipboard?.writeText(jeton)}>
              Copier
            </button>
          </div>
        </div>

        <div>
          <label className="libelle">Configuration à ajouter dans Claude</label>
          <textarea className="champ mono" rows={12} readOnly value={configuration} />
          <div className="rangee" style={{ marginTop: 6 }}>
            <button className="bouton" onClick={() => void navigator.clipboard?.writeText(configuration)}>
              Copier la configuration
            </button>
          </div>
          <div className="aide-champ">
            Le serveur MCP peut aussi être joint directement en HTTP sur {window.location.origin}/mcp,
            avec l’en-tête x-previs-token.
          </div>
        </div>
      </div>
    </Modale>
  );
}

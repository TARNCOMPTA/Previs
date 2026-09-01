import type { CleAcces } from '@previs/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { annulerCeremonie, clesPossibles, enrolerCle, messageErreurCle } from '../api/cles.js';
import { useSession } from '../store/session.js';
import { ChampTexte, Interrupteur } from '../ui/champs.js';
import { Bandeau, Chargement, Confirmation, Modale, ZoneVide } from '../ui/divers.js';

/**
 * Mon compte : mot de passe et clés d'accès.
 *
 * Deux choses qui n'appartiennent qu'au titulaire, et qui n'ont donc rien à faire dans
 * l'écran Administration — réservé aux administrateurs, alors qu'un collaborateur, et
 * même un compte en lecture seule, doit pouvoir sécuriser le sien.
 */
export function Compte() {
  const naviguer = useNavigate();
  const utilisateur = useSession((e) => e.utilisateur);

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
        <button className="bouton discret" onClick={() => naviguer('/')}>
          ←
        </button>
        <h1>Mon compte</h1>
        <div className="separateur" />
        <span className="discret">
          {utilisateur?.nom} — {utilisateur?.email}
        </span>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: 20 }} className="pile">
        <CarteMotDePasse />
        <CarteCles />
      </div>
    </div>
  );
}

/** Changement de mot de passe. Le serveur ferme toutes les sessions au succès. */
function CarteMotDePasse() {
  const naviguer = useNavigate();
  const deconnecter = useSession((e) => e.deconnecter);
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [revoquer, setRevoquer] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ connecteurs: number } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const tropCourt = nouveau.length > 0 && nouveau.length < 10;
  const discordant = confirmation.length > 0 && nouveau !== confirmation;
  const pretAEnvoyer = ancien.length > 0 && nouveau.length >= 10 && nouveau === confirmation;

  if (fait) {
    return (
      <section className="carte">
        <header>
          <div>
            <h2>Mot de passe modifié</h2>
            <div className="discret">
              Toutes vos sessions ont été fermées, sur cet appareil comme sur les autres.
              {fait.connecteurs > 0
                ? ' Les connecteurs autorisés sur ce compte ont perdu l’accès et redemanderont le consentement.'
                : ''}
            </div>
          </div>
        </header>
        <div className="corps">
          <button
            className="bouton principal"
            onClick={async () => {
              // Le serveur a déjà effacé le cookie ; il reste à vider l'état local.
              await deconnecter();
              naviguer('/connexion');
            }}
          >
            Se reconnecter
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="carte">
      <header>
        <div>
          <h2>Mot de passe</h2>
          <div className="discret">
            Dix caractères au moins. Le changer ferme toutes vos sessions ouvertes.
          </div>
        </div>
      </header>
      <div className="corps pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

        <div>
          <label className="libelle" htmlFor="ancien">
            Mot de passe actuel
          </label>
          <input
            id="ancien"
            className="champ"
            type="password"
            autoComplete="current-password"
            value={ancien}
            onChange={(e) => setAncien(e.target.value)}
          />
        </div>

        <div>
          <label className="libelle" htmlFor="nouveau">
            Nouveau mot de passe
          </label>
          <input
            id="nouveau"
            className={`champ${tropCourt ? ' invalide' : ''}`}
            type="password"
            autoComplete="new-password"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
          />
          {tropCourt ? <div className="aide-champ">Dix caractères au moins.</div> : null}
        </div>

        <div>
          <label className="libelle" htmlFor="confirmation">
            Confirmer le nouveau mot de passe
          </label>
          <input
            id="confirmation"
            className={`champ${discordant ? ' invalide' : ''}`}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          {discordant ? <div className="aide-champ">Les deux saisies diffèrent.</div> : null}
        </div>

        <Interrupteur
          valeur={revoquer}
          onChange={setRevoquer}
          libelle="Révoquer aussi les connecteurs autorisés sur ce compte"
          aide="Un connecteur a été autorisé avec le mot de passe que vous changez, et son accès vaut trente jours. Le révoquer l’oblige à redemander le consentement."
        />

        <div className="rangee">
          <button
            className="bouton principal"
            disabled={!pretAEnvoyer || envoi}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                const r = await api.changerMotDePasse(ancien, nouveau, revoquer);
                setFait({ connecteurs: r.connecteursRevoques });
              } catch (x) {
                setErreur(x instanceof Error ? x.message : 'Changement impossible.');
                setEnvoi(false);
              }
            }}
          >
            {envoi ? 'Enregistrement…' : 'Changer le mot de passe'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Clés d'accès du compte : liste, ajout, retrait. */
function CarteCles() {
  const naviguer = useNavigate();
  const deconnecter = useSession((e) => e.deconnecter);
  const [cles, setCles] = useState<CleAcces[] | null>(null);
  const [motifServeur, setMotifServeur] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [aRetirer, setARetirer] = useState<CleAcces | null>(null);
  const possible = clesPossibles();

  const charger = async () => {
    try {
      const r = await api.listerCles();
      setCles(r.cles);
      setMotifServeur(r.actives ? '' : r.motif);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : 'Chargement impossible.');
    }
  };

  useEffect(() => {
    void charger();
  }, []);

  return (
    <section className="carte">
      <header>
        <div>
          <h2>Clés d’accès</h2>
          <div className="discret">
            Une clé d’accès remplace le mot de passe par le déverrouillage de votre appareil.
            Elle ne quitte jamais celui-ci et ne signe que pour ce site : c’est ce qui la rend
            insensible aux faux courriels. En retirer une ferme toutes vos sessions.
          </div>
        </div>
        {possible && !motifServeur ? (
          <button className="bouton principal" onClick={() => setAjout(true)}>
            Ajouter une clé
          </button>
        ) : null}
      </header>
      <div className="corps">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
        {motifServeur ? (
          <Bandeau ton="alerte">
            Les clés d’accès sont indisponibles sur cette installation. {motifServeur}
          </Bandeau>
        ) : !possible ? (
          <Bandeau ton="alerte">
            Ce navigateur ne permet pas les clés d’accès, ou la page n’est pas servie en https.
          </Bandeau>
        ) : null}

        {!cles ? (
          <Chargement />
        ) : cles.length === 0 ? (
          <ZoneVide titre="Aucune clé d’accès enregistrée">
            Votre mot de passe reste le seul moyen de vous connecter.
          </ZoneVide>
        ) : (
          <table className="etat">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Clé</th>
                <th>Enregistrée le</th>
                <th>Dernière utilisation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cles.map((c) => (
                <tr key={c.id}>
                  <td style={{ textAlign: 'left' }}>
                    {c.libelle}
                    {c.synchronisee ? <span className="badge"> synchronisée</span> : null}
                  </td>
                  <td>{new Date(c.creeLe).toLocaleDateString('fr-FR')}</td>
                  <td className="discret">
                    {c.derniereUtilisation
                      ? new Date(c.derniereUtilisation).toLocaleString('fr-FR')
                      : 'jamais'}
                  </td>
                  <td>
                    <button
                      className="bouton discret petit danger"
                      onClick={() => setARetirer(c)}
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

      {ajout ? (
        <ModaleAjoutCle
          onFermer={() => {
            annulerCeremonie();
            setAjout(false);
          }}
          onAjoutee={charger}
        />
      ) : null}

      {aRetirer ? (
        <Confirmation
          titre="Retirer la clé d’accès"
          message={`« ${aRetirer.libelle} » ne pourra plus ouvrir ce compte, et toutes vos sessions seront fermées — c’est ce qui coupe l’accès de l’appareil perdu. Vous devrez vous reconnecter. Votre mot de passe reste valable.`}
          libelleAction="Retirer et se déconnecter"
          onAnnuler={() => setARetirer(null)}
          onConfirmer={async () => {
            await api.supprimerCle(aRetirer.id);
            setARetirer(null);
            // La session vient d'être fermée par le serveur : recharger la liste
            // provoquerait un 401 et un retour brutal. On y va franchement.
            await deconnecter();
            naviguer('/connexion');
          }}
        />
      ) : null}
    </section>
  );
}

function ModaleAjoutCle({
  onFermer,
  onAjoutee,
}: {
  onFermer: () => void;
  onAjoutee: () => Promise<void>;
}) {
  const [libelle, setLibelle] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  return (
    <Modale
      titre="Ajouter une clé d’accès"
      onFermer={onFermer}
      actions={
        <>
          <button className="bouton" onClick={onFermer}>
            Annuler
          </button>
          <button
            className="bouton principal"
            disabled={!libelle.trim() || !motDePasse || envoi}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await enrolerCle(libelle.trim(), motDePasse);
                await onAjoutee();
                onFermer();
              } catch (x) {
                const message = messageErreurCle(x);
                // Une cérémonie abandonnée n'est pas une erreur : rien à afficher.
                if (message) setErreur(message);
                setEnvoi(false);
              }
            }}
          >
            {envoi ? 'En attente de la clé…' : 'Enregistrer la clé'}
          </button>
        </>
      }
    >
      <div className="pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}
        <Bandeau ton="alerte">
          À enregistrer sur votre appareil personnel — téléphone, ordinateur, clé matérielle —
          jamais sur un poste partagé du cabinet.
        </Bandeau>
        <ChampTexte
          libelle="Nom de la clé"
          aide="Pour la reconnaître plus tard : « iPhone », « Mac du bureau », « clé YubiKey »."
          valeur={libelle}
          onChange={setLibelle}
          longueurMax={80}
          placeholder="iPhone"
        />
        <div>
          <label className="libelle" htmlFor="motdepasse-cle">
            Votre mot de passe actuel
          </label>
          <input
            id="motdepasse-cle"
            className="champ"
            type="password"
            autoComplete="current-password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
          <div className="aide-champ">
            Demandé pour qu’une session dérobée ne puisse pas ajouter de clé à votre place.
          </div>
        </div>
      </div>
    </Modale>
  );
}

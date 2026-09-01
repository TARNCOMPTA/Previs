import { useState } from 'react';
import { clesPossibles, messageErreurCle } from '../api/cles.js';
import { useSession } from '../store/session.js';
import { Bandeau } from '../ui/divers.js';

/** Écran de connexion. Le message d'erreur ne révèle jamais si l'adresse existe. */
export function Connexion() {
  const connecter = useSession((e) => e.connecter);
  const connecterParCle = useSession((e) => e.connecterParCle);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [envoiCle, setEnvoiCle] = useState(false);
  // Le navigateur est seul juge : l'API doit exister et la page être servie en contexte
  // sûr. Inutile d'offrir un bouton qui ne pourrait pas aboutir.
  const avecCles = clesPossibles();

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      await connecter(email, motDePasse);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : 'Connexion impossible.');
      setEnvoi(false);
    }
  };

  return (
    <div
      className="hauteur-minimale-fenetre"
      style={{ display: 'grid', placeItems: 'center', padding: 20 }}
    >
      <form className="carte" style={{ width: 380, maxWidth: '100%' }} onSubmit={soumettre}>
        <div className="corps pile">
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--bleu)', letterSpacing: 0.5 }}>
              Previs
            </div>
            <div className="discret">Prévisionnel financier — TARN COMPTA</div>
          </div>

          {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

          <div>
            <label className="libelle" htmlFor="email">
              Adresse électronique
            </label>
            <input
              id="email"
              className="champ"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="libelle" htmlFor="motdepasse">
              Mot de passe
            </label>
            <input
              id="motdepasse"
              className="champ"
              type="password"
              autoComplete="current-password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </div>

          <button className="bouton principal" type="submit" disabled={envoi} style={{ justifyContent: 'center' }}>
            {envoi ? 'Connexion…' : 'Se connecter'}
          </button>

          {avecCles ? (
            <>
              <div className="rangee" style={{ gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--trait)' }} />
                <span className="discret" style={{ fontSize: 12 }}>
                  ou
                </span>
                <div style={{ flex: 1, height: 1, background: 'var(--trait)' }} />
              </div>
              <button
                className="bouton"
                type="button"
                disabled={envoiCle}
                style={{ justifyContent: 'center' }}
                onClick={async () => {
                  setEnvoiCle(true);
                  setErreur(null);
                  try {
                    // Ni adresse ni mot de passe : la clé est découvrable, c'est
                    // l'authentificateur qui dit quel compte il ouvre.
                    await connecterParCle();
                  } catch (x) {
                    setErreur(messageErreurCle(x));
                    setEnvoiCle(false);
                  }
                }}
              >
                {envoiCle ? 'En attente de la clé…' : 'Se connecter avec une clé d’accès'}
              </button>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}

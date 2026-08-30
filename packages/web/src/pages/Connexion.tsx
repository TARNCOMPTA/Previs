import { useState } from 'react';
import { useSession } from '../store/session.js';
import { Bandeau } from '../ui/divers.js';

/** Écran de connexion. Le message d'erreur ne révèle jamais si l'adresse existe. */
export function Connexion() {
  const connecter = useSession((e) => e.connecter);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

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
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
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
        </div>
      </form>
    </div>
  );
}

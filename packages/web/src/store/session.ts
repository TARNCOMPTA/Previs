import type { Utilisateur } from '@previs/core';
import { create } from 'zustand';
import { api, definirSurDeconnexion } from '../api/client.js';

type Theme = 'clair' | 'sombre';

interface EtatSession {
  utilisateur: Utilisateur | null;
  chargement: boolean;
  theme: Theme;
  verifier: () => Promise<void>;
  connecter: (email: string, motDePasse: string) => Promise<void>;
  deconnecter: () => Promise<void>;
  basculerTheme: () => void;
}

/** Applique le thème à l'élément racine et le mémorise pour la prochaine visite. */
function appliquerTheme(theme: Theme): void {
  document.documentElement.classList.toggle('sombre', theme === 'sombre');
  try {
    localStorage.setItem('previs.theme', theme);
  } catch {
    // Navigation privée ou stockage refusé : le thème vaut alors pour la session seule.
  }
}

function themeInitial(): Theme {
  try {
    const memorise = localStorage.getItem('previs.theme');
    if (memorise === 'clair' || memorise === 'sombre') return memorise;
  } catch {
    // Ignoré : on retombe sur la préférence du système.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'sombre' : 'clair';
}

export const useSession = create<EtatSession>((set, get) => ({
  utilisateur: null,
  chargement: true,
  theme: themeInitial(),

  async verifier() {
    appliquerTheme(get().theme);
    try {
      const { utilisateur } = await api.moi();
      set({ utilisateur, chargement: false });
    } catch {
      set({ utilisateur: null, chargement: false });
    }
  },

  async connecter(email, motDePasse) {
    const { utilisateur } = await api.connexion(email, motDePasse);
    set({ utilisateur });
  },

  async deconnecter() {
    await api.deconnexion().catch(() => undefined);
    set({ utilisateur: null });
  },

  basculerTheme() {
    const theme = get().theme === 'clair' ? 'sombre' : 'clair';
    appliquerTheme(theme);
    set({ theme });
  },
}));

// Toute réponse 401 ramène l'utilisateur à l'écran de connexion.
definirSurDeconnexion(() => useSession.setState({ utilisateur: null }));

import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * L'interface consomme le moteur de calcul directement depuis les sources de
 * `@previs/core` : le rechargement à chaud fonctionne donc sans reconstruire le
 * paquet à chaque modification d'une formule financière.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@previs/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Les cartes de source publieraient le code du moteur et les libellés internes
    // sur un service exposé : elles restent réservées au mode développement.
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Le socle React ne change qu'à une montée de version : le séparer permet au
        // navigateur de le garder en cache d'une mise à jour du logiciel à l'autre.
        manualChunks(identifiant) {
          if (identifiant.includes('/node_modules/react') || identifiant.includes('/node_modules/scheduler')) {
            return 'socle';
          }
          if (identifiant.includes('/node_modules/zod')) return 'validation';
          return undefined;
        },
      },
    },
  },
});

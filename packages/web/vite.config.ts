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
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});

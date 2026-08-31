import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Les essais de l'interface, et pour l'instant ceux du magasin seulement.
 *
 * Le magasin est la pièce du paquet qui porte des chiffres de clients réels : c'est lui qui
 * décide ce qui part au serveur, ce qui est conservé et ce qui est remplacé. Un défaut y
 * perd une saisie, et l'audit en a relevé cinq. Rien n'y était éprouvé.
 *
 * `@previs/core` est consommé depuis ses sources, comme dans les autres paquets : les essais
 * restent exécutables sans reconstruction.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@previs/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 20000,
  },
});

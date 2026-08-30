import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Les essais consomment `@previs/core` depuis ses sources : ils restent exécutables
 * sans avoir reconstruit le paquet, comme l'interface le fait déjà.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@previs/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // better-sqlite3 et Chromium sont des modules natifs : un seul processus suffit.
    pool: 'forks',
    testTimeout: 20000,
  },
});

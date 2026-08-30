#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AUTEUR_MCP, creerDepotHttp } from './depotHttp.js';
import { creerServeurMcp } from './index.js';

/**
 * Serveur MCP autonome, à brancher dans Claude Desktop ou Claude Code.
 *
 * Il ne détient aucune donnée : il dialogue avec le serveur Previs du cabinet par
 * son API HTTP, authentifié par un jeton créé dans l'écran d'administration.
 */
async function demarrer(): Promise<void> {
  const url = process.env.PREVIS_URL;
  const jeton = process.env.PREVIS_TOKEN;

  if (!url || !jeton) {
    process.stderr.write(
      'Configuration incomplète du serveur MCP Previs.\n' +
        '  PREVIS_URL   adresse du serveur, par exemple https://previs.tarncompta.fr\n' +
        '  PREVIS_TOKEN jeton d’API créé dans l’écran Administration de Previs\n',
    );
    process.exit(1);
  }

  const serveur = creerServeurMcp(creerDepotHttp(url, jeton), AUTEUR_MCP);
  await serveur.connect(new StdioServerTransport());
  process.stderr.write(`Serveur MCP Previs connecté à ${url}\n`);
}

demarrer().catch((erreur) => {
  process.stderr.write(`Le serveur MCP n’a pas pu démarrer : ${erreur instanceof Error ? erreur.message : erreur}\n`);
  process.exit(1);
});

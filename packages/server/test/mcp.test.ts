import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creerServeurMcp } from '@previs/mcp';
import { ouvrirBase } from '../src/base.js';
import { DepotSqlite } from '../src/depot.js';
import { ENTETE_JETON, type Auteur } from '@previs/core';
import { construireApplication } from '../src/index.js';
import type { Configuration } from '../src/config.js';

/**
 * Cohabitation de l'assistant et du clavier, par le chemin MCP réel.
 *
 * Le scénario verrouillé ici est celui qui a été observé en conditions réelles :
 * l'expert-comptable corrige un montant dans l'interface, l'assistant écrit ensuite
 * un tableau « montants » recopié depuis une lecture antérieure, et la saisie
 * disparaît sans qu'aucun contrôle de cohérence ne le signale — le dossier reste
 * équilibré, un chiffre client ayant simplement été remplacé par un autre.
 */
const ASSISTANT: Auteur = { id: 'utl_1', nom: 'Assistant · Aymeric HANGARD', origine: 'mcp' };
const CLAVIER: Auteur = { id: 'utl_1', nom: 'Aymeric HANGARD', origine: 'interface' };

async function brancher(depot: DepotSqlite) {
  const serveur = creerServeurMcp(depot, ASSISTANT);
  const client = new Client({ name: 'essai', version: '1.0' }, { capabilities: {} });
  const [versClient, versServeur] = InMemoryTransport.createLinkedPair();
  await Promise.all([serveur.connect(versServeur), client.connect(versClient)]);
  return client;
}

function texteDe(resultat: unknown): string {
  const r = resultat as { content?: Array<{ text?: string }>; isError?: boolean };
  return (r.content ?? []).map((c) => c.text ?? '').join('\n');
}

describe('l’assistant n’écrase pas une saisie faite au clavier', () => {
  let depot: DepotSqlite;
  let client: Client;
  let dossierId: string;
  let ligneId: string;

  beforeEach(async () => {
    depot = new DepotSqlite(ouvrirBase(':memory:'));
    client = await brancher(depot);

    const cree = await depot.creer({ nom: 'Essai', modele: 'IS' }, ASSISTANT);
    dossierId = cree.id;
    ligneId = cree.dossier.recettes.lignes[0].id;

    // L'assistant pose un chiffre d'affaires sur les trois exercices.
    await depot.appliquer(
      dossierId,
      {
        operations: [
          {
            action: 'modifier_ligne',
            liste: 'recettes.lignes',
            id: ligneId,
            champs: { montants: [176000, 190000, 199600] },
          },
        ],
        commentaire: 'Chiffre d’affaires initial',
      },
      ASSISTANT,
    );
  });

  /** L'expert-comptable corrige le premier exercice dans l'interface. */
  async function saisirAuClavier(): Promise<number> {
    const actuel = await depot.lire(dossierId);
    const dossier = structuredClone(actuel!.dossier);
    dossier.recettes.lignes[0].montants = [99000, 190000, 199600];
    const apres = await depot.enregistrer(
      dossierId,
      { dossier, versionAttendue: actuel!.version, commentaire: 'Saisie' },
      CLAVIER,
    );
    return apres.version;
  }

  it('une écriture non versionnée juste après une saisie au clavier est refusée', async () => {
    const versionClavier = await saisirAuClavier();

    const reponse = await client.callTool({
      name: 'modifier_ligne',
      arguments: {
        dossierId,
        liste: 'recettes.lignes',
        id: ligneId,
        // Le tableau recopié depuis la lecture d'avant la saisie.
        champs: { montants: [176000, 190000, 199500] },
      },
    });

    expect((reponse as { isError?: boolean }).isError).toBe(true);
    expect(texteDe(reponse)).toContain('modifié au clavier');
    expect(texteDe(reponse)).toContain(`versionAttendue = ${versionClavier}`);

    const apres = await depot.lire(dossierId);
    expect(apres!.dossier.recettes.lignes[0].montants[0]).toBe(99000);
  });

  it('une écriture fondée sur une version périmée est refusée', async () => {
    const actuel = await depot.lire(dossierId);
    const versionLue = actuel!.version;
    await saisirAuClavier();

    const reponse = await client.callTool({
      name: 'modifier_ligne',
      arguments: {
        dossierId,
        liste: 'recettes.lignes',
        id: ligneId,
        champs: { montants: [176000, 190000, 199500] },
        versionAttendue: versionLue,
      },
    });

    expect((reponse as { isError?: boolean }).isError).toBe(true);
    expect(texteDe(reponse)).toContain('modifié entre-temps');

    const apres = await depot.lire(dossierId);
    expect(apres!.dossier.recettes.lignes[0].montants[0]).toBe(99000);
  });

  it('après relecture, l’écriture sur la version à jour est acceptée', async () => {
    await saisirAuClavier();
    const relu = await depot.lire(dossierId);

    const reponse = await client.callTool({
      name: 'modifier_ligne',
      arguments: {
        dossierId,
        liste: 'recettes.lignes',
        id: ligneId,
        // L'assistant ne visait que le troisième exercice : il repart des valeurs à jour.
        champs: { montants: [99000, 190000, 199500] },
        versionAttendue: relu!.version,
      },
    });

    expect((reponse as { isError?: boolean }).isError).toBeFalsy();
    const apres = await depot.lire(dossierId);
    expect(apres!.dossier.recettes.lignes[0].montants).toEqual([99000, 190000, 199500]);
  });

  it('l’assistant écrit librement tant que personne n’a touché au clavier', async () => {
    const reponse = await client.callTool({
      name: 'ajouter_lignes',
      arguments: {
        dossierId,
        liste: 'recettes.lignes',
        lignes: [{ libelle: 'Pâtisserie', montants: [67200, 72600, 76200] }],
      },
    });

    expect((reponse as { isError?: boolean }).isError).toBeFalsy();
    const apres = await depot.lire(dossierId);
    expect(apres!.dossier.recettes.lignes).toHaveLength(2);
  });

  it('« versionAttendue » n’est jamais écrit comme un champ du dossier', async () => {
    const relu = await depot.lire(dossierId);
    await client.callTool({
      name: 'definir_identite',
      arguments: { dossierId, raisonSociale: 'Boulangerie', versionAttendue: relu!.version },
    });

    const apres = await depot.lire(dossierId);
    expect(apres!.dossier.identite.raisonSociale).toBe('Boulangerie');
    expect('versionAttendue' in (apres!.dossier.identite as Record<string, unknown>)).toBe(false);
  });
});

/**
 * Le plafond d'exports PDF, éprouvé par le vrai point d'entrée HTTP.
 *
 * L'outil « generer_pdf » lance un Chromium complet — huit cents millisecondes mesurées —
 * et le protocole MCP ne plafonne rien de lui-même. La route `POST /api/dossiers/:id/pdf`
 * comptait ses appels depuis toujours ; ce chemin-ci ne comptait rien, et un porteur de
 * jeton pouvait boucler l'outil jusqu'à saturer le processeur du serveur.
 *
 * Chromium est remplacé par un compteur : ce qui est éprouvé ici est le plafond, non le
 * rendu, et trente rendus réels coûteraient une demi-minute d'essais.
 */
describe('l’export PDF de l’assistant est plafonné', () => {
  const ORIGINE = 'https://previs.tarncompta.fr';
  const MOT_DE_PASSE = 'motdepasse-de-test-2026';
  const PLAFOND = 30;

  const config = {
    port: 0,
    host: '127.0.0.1',
    urlPublique: ORIGINE,
    secretSession: 'secret-d-essai-suffisamment-long-pour-le-test',
    cheminBase: ':memory:',
    cheminStatique: '/chemin/qui-n-existe-pas',
    cheminChromium: '/usr/bin/chromium',
    cookiesSecurises: true,
    confianceProxy: 'loopback',
    niveauJournal: 'silent',
    mcpHttpActif: true,
    production: true,
    bootstrap: { email: '', motDePasse: '', nom: '' },
  } as Configuration;

  async function monter() {
    const e = await construireApplication(config);
    let rendus = 0;
    // La substitution porte sur l'instance : `bornerExportPdf` la prend pour prototype et
    // appelle bien celle-ci, comme le fait la route HTTP.
    (e.depot as unknown as { pdf: () => Promise<Uint8Array> }).pdf = async () => {
      rendus += 1;
      return new Uint8Array([37]);
    };

    const utilisateur = await e.auth.creerUtilisateur({
      email: 'assistant@tarncompta.fr',
      nom: 'Aymeric HANGARD',
      motDePasse: MOT_DE_PASSE,
      role: 'admin',
    });
    const session = await e.app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: 'assistant@tarncompta.fr', motDePasse: MOT_DE_PASSE },
    });
    const brut = session.headers['set-cookie'];
    const cookie = (Array.isArray(brut) ? brut[0] : (brut ?? '')).split(';')[0];
    const jetonApi = (
      await e.app.inject({
        method: 'POST',
        url: '/api/jetons',
        headers: { cookie, origin: ORIGINE },
        payload: { libelle: 'Assistant', validiteJours: 1 },
      })
    ).json().jeton as string;

    const cree = await e.depot.creer(
      { nom: 'Essai', modele: 'IS' },
      { id: utilisateur.id, nom: 'Aymeric HANGARD', origine: 'interface' },
    );

    const parMcp = () =>
      e.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          [ENTETE_JETON]: jetonApi,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'generer_pdf',
            arguments: { dossierId: cree.id, ignorerControles: true },
          },
        },
      });

    const parRouteHttp = () =>
      e.app.inject({
        method: 'POST',
        url: `/api/dossiers/${cree.id}/pdf`,
        headers: { [ENTETE_JETON]: jetonApi },
      });

    return {
      e,
      parMcp,
      parRouteHttp,
      rendus: () => rendus,
      fermer: async () => {
        await e.app.close();
        e.base.close();
      },
    };
  }

  /** Le corps de la réponse arrive en flux d'événements : on en extrait le JSON. */
  function resultatMcp(corps: string): { text: string; isError: boolean } {
    const ligne = corps.split('\n').find((l) => l.startsWith('data:'));
    const charge = JSON.parse((ligne ?? '').slice(5)) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    const resultat = charge.result ?? {};
    return {
      text: (resultat.content ?? []).map((c) => c.text ?? '').join('\n'),
      isError: Boolean(resultat.isError),
    };
  }

  it('le trente-et-unième appel est refusé, sans avoir lancé Chromium', async () => {
    const s = await monter();
    try {
      for (let i = 0; i < PLAFOND; i++) {
        const r = resultatMcp((await s.parMcp()).body);
        expect(r.isError, `appel ${i + 1}`).toBe(false);
      }
      expect(s.rendus()).toBe(PLAFOND);

      const refuse = resultatMcp((await s.parMcp()).body);
      expect(refuse.isError).toBe(true);
      expect(refuse.text).toMatch(/Trop d’exports PDF/);
      // Le refus intervient AVANT le rendu : le compteur n'a pas bougé.
      expect(s.rendus()).toBe(PLAFOND);
    } finally {
      await s.fermer();
    }
  });

  it('le budget est unique : l’assistant épuise aussi celui de la route HTTP', async () => {
    const s = await monter();
    try {
      for (let i = 0; i < PLAFOND; i++) await s.parMcp();
      const parRoute = await s.parRouteHttp();
      expect(parRoute.statusCode).toBe(429);
      expect(s.rendus()).toBe(PLAFOND);
    } finally {
      await s.fermer();
    }
  });

  it('et réciproquement : la route HTTP épuise celui de l’assistant', async () => {
    const s = await monter();
    try {
      for (let i = 0; i < PLAFOND; i++) {
        expect((await s.parRouteHttp()).statusCode, `appel ${i + 1}`).toBe(200);
      }
      const refuse = resultatMcp((await s.parMcp()).body);
      expect(refuse.isError).toBe(true);
      expect(s.rendus()).toBe(PLAFOND);
    } finally {
      await s.fermer();
    }
  });
});

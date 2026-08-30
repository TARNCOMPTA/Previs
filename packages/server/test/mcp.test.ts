import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { creerServeurMcp } from '@previs/mcp';
import { ouvrirBase } from '../src/base.js';
import { DepotSqlite } from '../src/depot.js';
import type { Auteur } from '@previs/core';

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

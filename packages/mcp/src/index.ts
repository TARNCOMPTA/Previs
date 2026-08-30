import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LIBELLES_CHEMIN_LISTE, type Auteur, type DepotDossiers } from '@previs/core';
import { enregistrerOutils } from './outils.js';

export { creerDepotHttp, AUTEUR_MCP } from './depotHttp.js';
export * from './rendu.js';

const MODE_EMPLOI = `# Previs — mode d’emploi du serveur

Previs est le logiciel de prévisionnel financier du cabinet TARN COMPTA. Les données
sont saisies indifféremment par vous, via ces outils, ou à la main dans l’interface
graphique : les deux écrivent dans le même dossier, en temps réel.

## Enchaînement type

1. **lister_dossiers** pour retrouver l’identifiant, ou **creer_dossier** pour en ouvrir un.
2. **definir_identite** : raison sociale, forme juridique, régime fiscal, activité.
   Le régime (IS, BNC, BIC_IR) pilote tout le moteur : le fixer en premier.
3. **definir_parametres** : date de début, nombre d’exercices, TVA, délais de règlement,
   taux de charges sociales, trésorerie initiale.
4. **ajouter_lignes** section par section : investissements, financements, charges,
   personnel, recettes, éléments exceptionnels.
5. **calculer_dossier** puis **controler_coherence** pour vérifier l’équilibre du bilan.
6. **generer_pdf** une fois tous les contrôles au vert.

## Règles du cabinet

- **Ne jamais inventer un chiffre.** Si une donnée manque, la demander explicitement.
  Une ligne créée à zéro n’apparaît pas dans le dossier remis : c’est la bonne façon
  de proposer une trame sans présumer des montants.
- **Ne jamais boucher un écart de bilan.** Si un contrôle signale un écart, en chercher
  la cause dans le besoin en fonds de roulement ou les flux, jamais dans un compte d’attente.
- **Signaler une incohérence économique.** Une croissance de 200 % sans justification,
  une trésorerie durablement négative ou une capacité de remboursement au-delà de cinq
  ans doivent être portées à la connaissance de l’expert-comptable.

## Conventions

- Montants en euros, taux en pourcentage (20 signifie 20 %).
- Index d’exercice à partir de 0 : 0 est le premier exercice du prévisionnel.
- Mois à partir de 1 : 1 est le premier mois de l’exercice concerné, pas de l’année civile.
- Les tableaux « par exercice » comportent un montant par exercice, dans l’ordre.
`;

const SCHEMA_DOSSIER = `# Structure d’un dossier prévisionnel

identite            raisonSociale, formeJuridique, regime (IS | BNC | BIC_IR), typeDossier,
                    activite, codeNaf, siret, adresse, email, telephone, dirigeants[],
                    introduction, rappelProcedure
parametres          dateDebut, nbExercices, dureePremierExerciceMois, tresorerieInitiale, cfe[],
                    tva { assujetti, regime, tauxParDefaut, decalageDecaissementMois, creditReportable },
                    is { tauxReduit, plafondTauxReduit, tauxNormal, eligibleTauxReduit, decalagePaiementMois, acomptes },
                    tns { tauxCotisations, cotisationsMinimales, assietteResultatAvantCotisations, periodicite },
                    ir { tauxMoyen, decaisse },
                    social { tauxChargesPatronales, tauxChargesSalariales, periodicite, decalageMois },
                    bfr { delaiClientsJours, delaiFournisseursJours, rotationStockJours, partComptantPourcent },
                    reserveLegalePourcent, plafondReserveLegalePourcent, tauxInteretCompteCourant

${Object.entries(LIBELLES_CHEMIN_LISTE)
  .map(([chemin, libelle]) => `${chemin.padEnd(28)}${libelle}`)
  .join('\n')}

Toute ligne porte : id, libelle, note, origine (manuel | llm | import), actif.
Les lignes de charges, de recettes, d’exceptionnels et de distributions portent en plus
une clé de répartition mensuelle :
  { type: "lineaire" }
  { type: "ponctuel", mois: 1..24 }
  { type: "demarrage", moisDebut: 1..24 }
  { type: "saisonnalite", poids: [12 nombres relatifs] }
  { type: "mensuel", montants: [[12 montants par exercice]] }
`;

/**
 * Construit un serveur MCP branché sur un dépôt de dossiers.
 *
 * Le serveur est sans état : il peut être monté dans le serveur HTTP du cabinet
 * comme être lancé en processus autonome sur le poste de l'utilisateur.
 */
export function creerServeurMcp(depot: DepotDossiers, auteur: Auteur): McpServer {
  const serveur = new McpServer(
    { name: 'previs', version: '1.0.0' },
    {
      instructions:
        'Serveur du logiciel de prévisionnel financier Previs (cabinet TARN COMPTA). ' +
        'Lire la ressource previs://mode-emploi avant de remplir un dossier.',
    },
  );

  enregistrerOutils(serveur, depot, auteur);

  serveur.registerResource(
    'mode-emploi',
    'previs://mode-emploi',
    {
      title: 'Mode d’emploi',
      description: 'Enchaînement type pour remplir un dossier, et règles du cabinet.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{ uri: 'previs://mode-emploi', mimeType: 'text/markdown', text: MODE_EMPLOI }],
    }),
  );

  serveur.registerResource(
    'schema-dossier',
    'previs://schema-dossier',
    {
      title: 'Structure d’un dossier',
      description: 'Champs disponibles dans chaque section d’un dossier prévisionnel.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{ uri: 'previs://schema-dossier', mimeType: 'text/markdown', text: SCHEMA_DOSSIER }],
    }),
  );

  return serveur;
}

/**
 * Traite une requête MCP en HTTP depuis une route Fastify.
 *
 * Le transport est utilisé sans session : un serveur est construit par requête, ce qui
 * évite toute mémoire partagée entre deux jetons d'API distincts.
 */
export async function traiterRequeteHttp(
  serveur: McpServer,
  requete: { raw: import('node:http').IncomingMessage; body?: unknown },
  reponse: { raw: import('node:http').ServerResponse; hijack: () => void },
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reponse.hijack();
  try {
    await serveur.connect(transport);
    await transport.handleRequest(requete.raw, reponse.raw, requete.body);
  } finally {
    reponse.raw.on('close', () => {
      void transport.close();
      void serveur.close();
    });
  }
}

// ─── Modèle de données ────────────────────────────────────────────────────────
export * from './model/common.js';
export * from './model/identite.js';
export * from './model/cabinet.js';
export * from './model/parametres.js';
export * from './model/investissements.js';
export * from './model/financements.js';
export * from './model/charges.js';
export * from './model/recettes.js';
export * from './model/autres.js';
export * from './model/dossier.js';

// ─── Contrat d'API partagé (serveur, interface, MCP) ──────────────────────────
export * from './api/contract.js';
export * from './api/cles.js';
export * from './api/oauth.js';
export * from './api/operations.js';
export * from './api/depot.js';

// ─── Moteur de calcul ─────────────────────────────────────────────────────────
export * from './engine/types.js';
export * from './engine/utils.js';
export * from './engine/periodes.js';
export * from './engine/repartition.js';
export * from './engine/index.js';

// ─── Modèles de dossiers pré-remplis ──────────────────────────────────────────
export * from './modeles/index.js';

// ─── Formatage ────────────────────────────────────────────────────────────────
export * from './format.js';

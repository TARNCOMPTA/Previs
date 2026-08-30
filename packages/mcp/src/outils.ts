import {
  calculer,
  ErreurDepot,
  LIBELLES_CHEMIN_LISTE,
  zCheminListe,
  zOperation,
  type Auteur,
  type DepotDossiers,
  type DossierEnregistre,
  type Operation,
} from '@previs/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { etatControles, rendreEtat, synthese, tableauTexte } from './rendu.js';

type Reponse = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function texte(...morceaux: string[]): Reponse {
  return { content: [{ type: 'text', text: morceaux.filter(Boolean).join('\n\n') }] };
}

function erreur(message: string): Reponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Traduit une erreur du dépôt en message exploitable par le modèle. */
function messageErreur(e: unknown): string {
  if (e instanceof ErreurDepot) {
    if (e.code === 'conflit_version') {
      return `${e.message}\nRelire le dossier avec lire_dossier, puis rejouer la modification sur la version à jour.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Écrit dans un dossier et rend compte au modèle.
 *
 * Chaque écriture renvoie le journal des modifications et l'état des contrôles de
 * cohérence : le modèle voit immédiatement s'il vient de déséquilibrer le bilan.
 * Un conflit de version est rejoué une fois sur la version à jour, puisque les
 * opérations sont ciblées et n'écrasent pas les saisies faites au clavier entre-temps.
 */
async function ecrire(
  depot: DepotDossiers,
  auteur: Auteur,
  dossierId: string,
  operations: Operation[],
  commentaire: string,
): Promise<Reponse> {
  try {
    let resultat;
    try {
      resultat = await depot.appliquer(dossierId, { operations, commentaire }, auteur);
    } catch (e) {
      if (!(e instanceof ErreurDepot) || e.code !== 'conflit_version') throw e;
      resultat = await depot.appliquer(dossierId, { operations, commentaire }, auteur);
    }

    const calculs = calculer(resultat.dossier.dossier);
    return texte(
      `Dossier « ${resultat.dossier.nom} » enregistré en version ${resultat.dossier.version}.`,
      resultat.journal.length ? `Modifications appliquées :\n${resultat.journal.map((j) => `  ${j}`).join('\n')}` : '',
      resultat.erreurs.length ? `Opérations refusées :\n${resultat.erreurs.map((j) => `  ${j}`).join('\n')}` : '',
      synthese(calculs),
      etatControles(calculs),
    );
  } catch (e) {
    return erreur(messageErreur(e));
  }
}

/** Décrit un dossier en texte, avec le détail de ses cinq sections. */
function decrire(enregistre: DossierEnregistre): string {
  const d = enregistre.dossier;
  const r = calculer(d);
  const annees = r.exercices.map((e) => e.libelle);

  const listes: Array<[string, Array<{ id: string; libelle: string; actif?: boolean }>]> = [
    ['investissements.lignes', d.investissements.lignes],
    ['investissements.cessions', d.investissements.cessions],
    ['financements.apports', d.financements.apports],
    ['financements.emprunts', d.financements.emprunts],
    ['financements.subventions', d.financements.subventions],
    ['financements.creditsBaux', d.financements.creditsBaux],
    ['charges.lignes', d.charges.lignes],
    ['charges.personnel', d.charges.personnel],
    ['recettes.lignes', d.recettes.lignes],
    ['autres.exceptionnels', d.autres.exceptionnels],
    ['autres.distributions', d.autres.distributions],
    ['autres.passifDeclare', d.autres.passifDeclare],
  ];

  const contenu = listes
    .filter(([, lignes]) => lignes.length > 0)
    .map(
      ([chemin, lignes]) =>
        `${LIBELLES_CHEMIN_LISTE[chemin as keyof typeof LIBELLES_CHEMIN_LISTE]} (${chemin}) :\n` +
        lignes.map((l) => `  ${l.id}  ${l.libelle}${l.actif === false ? '  [désactivée]' : ''}`).join('\n'),
    )
    .join('\n\n');

  return [
    `Dossier « ${enregistre.nom} » — version ${enregistre.version}, modifié le ${enregistre.modifieLe} par ${enregistre.modifiePar}.`,
    `Client : ${d.identite.raisonSociale || '(non renseigné)'} — ${d.identite.formeJuridique || 'forme non renseignée'} — régime ${d.identite.regime}`,
    `Activité : ${d.identite.activite || '(non renseignée)'}`,
    `Période : ${annees.join(', ')} — début le ${d.parametres.dateDebut}`,
    `TVA : ${d.parametres.tva.assujetti ? `assujetti, régime ${d.parametres.tva.regime}, taux par défaut ${d.parametres.tva.tauxParDefaut} %` : 'non assujetti'}`,
    `Délais : clients ${d.parametres.bfr.delaiClientsJours} j, fournisseurs ${d.parametres.bfr.delaiFournisseursJours} j, stock ${d.parametres.bfr.rotationStockJours} j`,
    '',
    contenu || 'Aucune ligne saisie pour le moment.',
    '',
    synthese(r),
    '',
    etatControles(r),
  ].join('\n');
}

const zDossierId = z.string().min(1).describe('Identifiant du dossier, obtenu par lister_dossiers.');

/** Enregistre les quinze outils du serveur MCP. */
export function enregistrerOutils(serveur: McpServer, depot: DepotDossiers, auteur: Auteur): void {
  // ─── Lecture ────────────────────────────────────────────────────────────────
  serveur.registerTool(
    'lister_dossiers',
    {
      title: 'Lister les dossiers',
      description:
        'Liste tous les dossiers prévisionnels du cabinet, avec leur identifiant, le client, la période couverte et l’état des contrôles de cohérence. À appeler en premier pour retrouver l’identifiant d’un dossier.',
      inputSchema: {},
    },
    async () => {
      const dossiers = await depot.lister();
      if (dossiers.length === 0) return texte('Aucun dossier n’existe encore. Utiliser creer_dossier.');
      return texte(
        tableauTexte(
          ['Identifiant', 'Nom', 'Client', 'Régime', 'Période', 'Version', 'Cohérent'],
          dossiers.map((d) => [
            d.id,
            d.nom,
            d.client || '—',
            d.regime,
            `${d.anneeDebut} (${d.nbExercices} ex.)`,
            String(d.version),
            d.coherent ? 'oui' : 'NON',
          ]),
        ),
      );
    },
  );

  serveur.registerTool(
    'lire_dossier',
    {
      title: 'Lire un dossier',
      description:
        'Renvoie le contenu complet d’un dossier : identité, paramètres, et l’identifiant de chaque ligne des cinq sections, avec la synthèse financière et les contrôles. Les identifiants de ligne servent ensuite à modifier_ligne et supprimer_ligne.',
      inputSchema: { dossierId: zDossierId },
    },
    async ({ dossierId }) => {
      const enregistre = await depot.lire(dossierId);
      if (!enregistre) return erreur(`Aucun dossier ne porte l’identifiant ${dossierId}.`);
      return texte(decrire(enregistre));
    },
  );

  serveur.registerTool(
    'creer_dossier',
    {
      title: 'Créer un dossier',
      description:
        'Crée un dossier prévisionnel. Le modèle choisi pré-remplit une trame de charges usuelles à zéro, adaptée au régime : aucun chiffre n’est inventé, seuls les libellés sont proposés.',
      inputSchema: {
        nom: z.string().min(1).max(200).describe('Nom du dossier, en général la raison sociale du client.'),
        modele: z
          .enum(['vide', 'IS', 'BNC', 'BIC_IR'])
          .default('vide')
          .describe(
            'vide : aucune ligne. IS : société à l’impôt sur les sociétés. BNC : profession libérale au réel. BIC_IR : entreprise individuelle au réel.',
          ),
      },
    },
    async ({ nom, modele }) => {
      try {
        const cree = await depot.creer({ nom, modele }, auteur);
        return texte(`Dossier créé : ${cree.id}`, decrire(cree));
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  // ─── Écriture ───────────────────────────────────────────────────────────────
  serveur.registerTool(
    'definir_identite',
    {
      title: 'Définir l’identité du dossier',
      description:
        'Renseigne l’identité du client et le texte d’introduction du rapport. Seuls les champs fournis sont modifiés.',
      inputSchema: {
        dossierId: zDossierId,
        raisonSociale: z.string().max(200).optional(),
        formeJuridique: z.string().max(80).optional().describe('SAS, SARL, EURL, entreprise individuelle…'),
        regime: z
          .enum(['IS', 'BNC', 'BIC_IR'])
          .optional()
          .describe('Régime fiscal : pilote tout le moteur de calcul.'),
        typeDossier: z
          .enum(['creation', 'reprise', 'developpement', 'financement', 'plan_continuation'])
          .optional(),
        activite: z.string().max(300).optional(),
        codeNaf: z.string().max(10).optional(),
        siret: z.string().max(20).optional(),
        adresse: z
          .object({
            voie: z.string().max(200).default(''),
            complement: z.string().max(200).default(''),
            codePostal: z.string().max(10).default(''),
            ville: z.string().max(120).default(''),
          })
          .optional(),
        email: z.string().max(150).optional(),
        telephone: z.string().max(30).optional(),
        introduction: z
          .string()
          .max(20000)
          .optional()
          .describe('Introduction rédigée du rapport. Séparer les paragraphes par une ligne vide.'),
        rappelProcedure: z
          .string()
          .max(20000)
          .optional()
          .describe('Rappel de la procédure, pour un plan de continuation uniquement.'),
      },
    },
    async ({ dossierId, ...champs }) => {
      const operations: Operation[] = Object.entries(champs)
        .filter(([, valeur]) => valeur !== undefined)
        .map(([cle, valeur]) => ({ action: 'definir', chemin: `identite.${cle}`, valeur }));
      if (operations.length === 0) return erreur('Aucun champ d’identité n’a été fourni.');
      return ecrire(depot, auteur, dossierId, operations, 'Identité du dossier');
    },
  );

  serveur.registerTool(
    'definir_parametres',
    {
      title: 'Définir les paramètres du dossier',
      description:
        'Renseigne les hypothèses du dossier : période, TVA, impôt sur les sociétés, cotisations, délais de règlement. Seuls les champs fournis sont modifiés. Les montants sont en euros, les taux en pourcentage (20 pour 20 %), les index d’exercice commencent à 0.',
      inputSchema: {
        dossierId: zDossierId,
        dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Premier jour du premier exercice, AAAA-MM-JJ.'),
        nbExercices: z.number().int().min(1).max(10).optional(),
        dureePremierExerciceMois: z.number().int().min(1).max(24).optional(),
        tresorerieInitiale: z.number().optional().describe('Trésorerie disponible au premier jour, en euros.'),
        cfe: z.array(z.number()).optional().describe('Cotisation foncière des entreprises, un montant par exercice.'),
        tvaAssujetti: z.boolean().optional(),
        tvaRegime: z.enum(['mensuel', 'trimestriel', 'annuel', 'franchise']).optional(),
        tvaTauxParDefaut: z.number().optional().describe('Taux de TVA par défaut, en pourcentage.'),
        delaiClientsJours: z.number().min(0).max(365).optional(),
        delaiFournisseursJours: z.number().min(0).max(365).optional(),
        rotationStockJours: z.number().min(0).max(365).optional(),
        partComptantPourcent: z.number().optional().describe('Part du chiffre d’affaires encaissée comptant, en pourcentage.'),
        tauxChargesPatronales: z.number().optional().describe('En pourcentage du brut.'),
        tauxChargesSalariales: z.number().optional(),
        tauxCotisationsTns: z.number().optional().describe('Taux de cotisations du gérant TNS ou de l’exploitant, en pourcentage.'),
        cotisationsMinimalesTns: z.number().optional(),
        tauxMoyenIR: z.number().optional().describe('Taux moyen d’IR estimé, pour un BNC ou un BIC à l’IR.'),
        eligibleTauxReduitIS: z.boolean().optional(),
      },
    },
    async ({ dossierId, ...champs }) => {
      const chemins: Record<string, string> = {
        dateDebut: 'parametres.dateDebut',
        nbExercices: 'parametres.nbExercices',
        dureePremierExerciceMois: 'parametres.dureePremierExerciceMois',
        tresorerieInitiale: 'parametres.tresorerieInitiale',
        cfe: 'parametres.cfe',
        tvaAssujetti: 'parametres.tva.assujetti',
        tvaRegime: 'parametres.tva.regime',
        tvaTauxParDefaut: 'parametres.tva.tauxParDefaut',
        delaiClientsJours: 'parametres.bfr.delaiClientsJours',
        delaiFournisseursJours: 'parametres.bfr.delaiFournisseursJours',
        rotationStockJours: 'parametres.bfr.rotationStockJours',
        partComptantPourcent: 'parametres.bfr.partComptantPourcent',
        tauxChargesPatronales: 'parametres.social.tauxChargesPatronales',
        tauxChargesSalariales: 'parametres.social.tauxChargesSalariales',
        tauxCotisationsTns: 'parametres.tns.tauxCotisations',
        cotisationsMinimalesTns: 'parametres.tns.cotisationsMinimales',
        tauxMoyenIR: 'parametres.ir.tauxMoyen',
        eligibleTauxReduitIS: 'parametres.is.eligibleTauxReduit',
      };
      const operations: Operation[] = Object.entries(champs)
        .filter(([, valeur]) => valeur !== undefined)
        .map(([cle, valeur]) => ({ action: 'definir', chemin: chemins[cle], valeur }));
      if (operations.length === 0) return erreur('Aucun paramètre n’a été fourni.');
      return ecrire(depot, auteur, dossierId, operations, 'Paramètres du dossier');
    },
  );

  serveur.registerTool(
    'ajouter_lignes',
    {
      title: 'Ajouter des lignes',
      description: [
        'Ajoute plusieurs lignes d’un coup dans une section. C’est l’outil principal pour remplir un dossier.',
        '',
        'Champs attendus selon la liste visée :',
        '  investissements.lignes  libelle, categorie (incorporel | corporel | financier | stock_initial | tresorerie_demarrage | frais_etablissement), montantHT, tauxTva, exercice (0 = premier), mois (1 à 12), modeAmortissement (lineaire | degressif | aucun), dureeAmortissementAnnees',
        '  financements.apports    libelle, type (capital | capital_nature | compte_courant | apport_personnel | prime_emission), montant, exercice, mois, apporteur',
        '  financements.emprunts   libelle, organisme, montant, tauxAnnuel, dureeMois, exerciceDeblocage, moisDeblocage, periodicite (mensuelle | trimestrielle | annuelle), typeDiffere (aucun | partiel | total), differeMois, tauxAssuranceAnnuel, fraisDossier',
        '  financements.subventions libelle, organisme, type (investissement | exploitation), montant, exercice, mois, repriseSurAnnees',
        '  financements.creditsBaux libelle, valeurBien, loyerMensuelHT, dureeMois, exerciceDebut, moisDebut, depotGarantie, valeurResiduelle',
        '  charges.lignes          libelle, categorie (achats_marchandises | achats_matieres | fournitures | sous_traitance | services_exterieurs | autres_services_exterieurs | impots_taxes | autres_charges | charges_financieres), mode (montant | pourcentage_ca), montants (un par exercice) ou pourcentages, tauxTva, tvaDeductible, fixe',
        '  charges.personnel       libelle, statut (salarie | dirigeant_assimile | dirigeant_tns | exploitant), effectifs (un par exercice), brutMensuel (un par exercice), nbMoisParExercice, exerciceEmbauche, moisEmbauche',
        '  recettes.lignes         libelle, nature (vente_marchandises | production_biens | prestations | honoraires | loyers | subvention_exploitation | autres_produits), mode (montants | croissance | volume_prix | capacite), montants ou base + tauxCroissance ou quantites + prixUnitaire, tauxTva',
        '  autres.exceptionnels    libelle, sens (produit | charge), montants, impacteTresorerie',
        '  autres.distributions    libelle, type (dividendes | prelevements_exploitant), montants',
        '',
        'Toute ligne peut porter une clé de répartition mensuelle : repartition = { type: "lineaire" } | { type: "ponctuel", mois } | { type: "demarrage", moisDebut } | { type: "saisonnalite", poids: [12 nombres] }.',
        'Ne jamais inventer de montant : si une donnée manque, la demander à l’expert-comptable.',
      ].join('\n'),
      inputSchema: {
        dossierId: zDossierId,
        liste: zCheminListe.describe('Section visée, par exemple recettes.lignes.'),
        lignes: z
          .array(z.record(z.unknown()))
          .min(1)
          .max(200)
          .describe('Lignes à ajouter. Les champs absents prennent leur valeur par défaut.'),
      },
    },
    async ({ dossierId, liste, lignes }) => {
      const operations: Operation[] = lignes.map((ligne) => ({ action: 'ajouter_ligne', liste, ligne }));
      return ecrire(depot, auteur, dossierId, operations, `Ajout de ${lignes.length} ligne(s) dans ${liste}`);
    },
  );

  serveur.registerTool(
    'modifier_ligne',
    {
      title: 'Modifier une ligne',
      description:
        'Modifie les champs d’une ligne existante, identifiée par son identifiant obtenu avec lire_dossier. Seuls les champs fournis sont écrasés : les autres, y compris ceux saisis au clavier dans l’interface, sont préservés.',
      inputSchema: {
        dossierId: zDossierId,
        liste: zCheminListe,
        id: z.string().min(1).describe('Identifiant de la ligne.'),
        champs: z.record(z.unknown()).describe('Champs à modifier et leurs nouvelles valeurs.'),
      },
    },
    async ({ dossierId, liste, id, champs }) =>
      ecrire(depot, auteur, dossierId, [{ action: 'modifier_ligne', liste, id, champs }], `Modification de ${id}`),
  );

  serveur.registerTool(
    'supprimer_ligne',
    {
      title: 'Supprimer une ligne',
      description: 'Supprime définitivement une ligne d’une section.',
      inputSchema: { dossierId: zDossierId, liste: zCheminListe, id: z.string().min(1) },
    },
    async ({ dossierId, liste, id }) =>
      ecrire(depot, auteur, dossierId, [{ action: 'supprimer_ligne', liste, id }], `Suppression de ${id}`),
  );

  serveur.registerTool(
    'appliquer_operations',
    {
      title: 'Appliquer des opérations',
      description:
        'Applique une suite d’opérations brutes sur un dossier : definir (chemin pointé et valeur), ajouter_ligne, modifier_ligne, supprimer_ligne, vider_liste. Échappatoire complète quand les autres outils ne suffisent pas.',
      inputSchema: {
        dossierId: zDossierId,
        operations: z.array(zOperation).min(1).max(500),
        commentaire: z.string().max(500).default(''),
      },
    },
    async ({ dossierId, operations, commentaire }) =>
      ecrire(depot, auteur, dossierId, operations, commentaire || 'Opérations groupées'),
  );

  // ─── Calcul et contrôle ─────────────────────────────────────────────────────
  serveur.registerTool(
    'calculer_dossier',
    {
      title: 'Calculer un dossier',
      description:
        'Recalcule tous les états financiers et renvoie la synthèse par exercice ainsi que l’état des contrôles de cohérence.',
      inputSchema: { dossierId: zDossierId },
    },
    async ({ dossierId }) => {
      try {
        const r = await depot.calculer(dossierId);
        return texte(synthese(r), etatControles(r));
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  serveur.registerTool(
    'etat_financier',
    {
      title: 'Consulter un état financier',
      description: 'Renvoie l’un des états financiers du dossier, sous forme de tableau aligné.',
      inputSchema: {
        dossierId: zDossierId,
        etat: z.enum([
          'compte_resultat',
          'sig',
          'caf',
          'ratios',
          'seuil',
          'bfr',
          'plan_financement',
          'tresorerie',
          'tva',
          'bilan',
          'amortissements',
          'emprunts',
        ]),
      },
    },
    async ({ dossierId, etat }) => {
      try {
        return texte(rendreEtat(await depot.calculer(dossierId), etat));
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  serveur.registerTool(
    'controler_coherence',
    {
      title: 'Contrôler la cohérence',
      description:
        'Vérifie les contrôles obligatoires du dossier — équilibre du bilan, cohérence du besoin en fonds de roulement, du plan de financement, du compte de résultat et de la TVA — et détaille chaque écart constaté.',
      inputSchema: { dossierId: zDossierId },
    },
    async ({ dossierId }) => {
      try {
        const r = await depot.calculer(dossierId);
        const detail = r.controles
          .map(
            (c) =>
              `${c.ok ? '  OK   ' : c.gravite === 'erreur' ? 'ERREUR ' : 'ATTENTION '}${c.libelle}` +
              `${c.exercice !== undefined ? ` — ${r.exercices[c.exercice]?.libelle ?? ''}` : ''}` +
              `${c.ok ? '' : ` (écart ${c.ecart} €)\n         ${c.message}`}`,
          )
          .join('\n');
        const anomalies = r.anomalies.length
          ? `\n\nAnomalies de saisie :\n${r.anomalies.map((a) => `  • ${a.message}`).join('\n')}`
          : '';
        return texte(detail + anomalies);
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  // ─── Versions et livrable ───────────────────────────────────────────────────
  serveur.registerTool(
    'lister_versions',
    {
      title: 'Lister les versions',
      description:
        'Historique des modifications d’un dossier, avec l’auteur et l’origine de chacune — interface ou assistant.',
      inputSchema: { dossierId: zDossierId },
    },
    async ({ dossierId }) => {
      try {
        const versions = await depot.versions(dossierId);
        return texte(
          tableauTexte(
            ['Version', 'Date', 'Auteur', 'Origine', 'Commentaire'],
            versions.map((v) => [String(v.version), v.creeLe, v.auteur, v.origine, v.commentaire]),
          ),
        );
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  serveur.registerTool(
    'restaurer_version',
    {
      title: 'Restaurer une version',
      description:
        'Remet le dossier dans l’état d’une version antérieure. La restauration crée une nouvelle version : rien n’est perdu.',
      inputSchema: { dossierId: zDossierId, version: z.number().int().min(1) },
    },
    async ({ dossierId, version }) => {
      try {
        const restaure = await depot.restaurer(dossierId, version, auteur);
        return texte(`Version ${version} restaurée.`, decrire(restaure));
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );

  serveur.registerTool(
    'generer_pdf',
    {
      title: 'Générer le dossier PDF',
      description:
        'Produit le dossier prévisionnel au format PDF, à la charte du cabinet. Refuse de produire le document si un contrôle de cohérence est en erreur, sauf mention explicite du contraire.',
      inputSchema: {
        dossierId: zDossierId,
        ignorerControles: z
          .boolean()
          .default(false)
          .describe('Produire le PDF malgré des contrôles en erreur. À n’utiliser qu’en connaissance de cause.'),
      },
    },
    async ({ dossierId, ignorerControles }) => {
      try {
        const r = await depot.calculer(dossierId);
        if (!r.coherent && !ignorerControles) {
          return erreur(
            'Le dossier présente des contrôles en erreur : le PDF n’a pas été produit.\n\n' +
              etatControles(r) +
              '\n\nCorriger ces écarts, ou rappeler generer_pdf avec ignorerControles à vrai.',
          );
        }
        const pdf = await depot.pdf(dossierId);
        return texte(
          `Dossier PDF produit : ${Math.round(pdf.byteLength / 1024)} Ko.`,
          'Le document est téléchargeable depuis l’interface, bouton « Exporter le dossier ».',
          etatControles(r),
        );
      } catch (e) {
        return erreur(messageErreur(e));
      }
    },
  );
}

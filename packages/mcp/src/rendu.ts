import { formaterMontant, formaterPourcentage, type Resultats } from '@previs/core';

/**
 * Rend un tableau en texte aligné.
 *
 * Le serveur MCP répond à un modèle de langage qui doit relire ses propres chiffres :
 * un tableau aligné se lit bien mieux qu'un objet JSON, et se recopie tel quel dans
 * une réponse à l'expert-comptable.
 */
export function tableauTexte(entetes: readonly string[], lignes: ReadonlyArray<readonly string[]>): string {
  const toutes = [entetes, ...lignes];
  const largeurs = entetes.map((_, c) => Math.max(...toutes.map((l) => (l[c] ?? '').length)));
  const rendre = (ligne: readonly string[]) =>
    ligne
      .map((cellule, c) => (c === 0 ? (cellule ?? '').padEnd(largeurs[c]) : (cellule ?? '').padStart(largeurs[c])))
      .join('  ')
      .trimEnd();
  const separateur = largeurs.map((l) => '─'.repeat(l)).join('  ');
  return [rendre(entetes), separateur, ...lignes.map(rendre)].join('\n');
}

const euros = (v: number) => formaterMontant(v).replace(/ /g, ' ');

/** Une ligne de tableau : un libellé puis un montant par exercice. */
export function ligneMontants(libelle: string, valeurs: readonly number[]): string[] {
  return [libelle, ...valeurs.map(euros)];
}

/** Synthèse courte d'un dossier, renvoyée après chaque écriture. */
export function synthese(r: Resultats): string {
  const annees = r.exercices.map((e) => e.libelle);
  const lignes = [
    ligneMontants('Chiffre d’affaires', r.compteResultat.map((c) => c.chiffreAffaires)),
    ligneMontants('Excédent brut d’exploitation', r.sig.map((s) => s.excedentBrutExploitation)),
    ligneMontants('Résultat net', r.compteResultat.map((c) => c.resultatNet)),
    ligneMontants('Capacité d’autofinancement', r.caf.map((c) => c.caf)),
    ligneMontants('Trésorerie à la clôture', r.tresorerie.soldeFinParExercice),
  ];
  return tableauTexte(['Indicateur', ...annees], lignes);
}

/** Bilan des contrôles de cohérence, à afficher après chaque écriture. */
export function etatControles(r: Resultats): string {
  const erreurs = r.controles.filter((c) => !c.ok && c.gravite === 'erreur');
  const avertissements = r.controles.filter((c) => !c.ok && c.gravite === 'avertissement');

  if (erreurs.length === 0 && avertissements.length === 0) {
    return 'Contrôles de cohérence : tous validés. Le dossier peut être transmis.';
  }

  const morceaux: string[] = [];
  if (erreurs.length > 0) {
    morceaux.push(
      `Contrôles en ERREUR (${erreurs.length}) — à corriger avant transmission :\n` +
        erreurs.map((c) => `  • ${c.libelle} : ${c.message}`).join('\n'),
    );
  }
  if (avertissements.length > 0) {
    morceaux.push(
      `Avertissements (${avertissements.length}) :\n` +
        avertissements.map((c) => `  • ${c.libelle} : ${c.message}`).join('\n'),
    );
  }
  return morceaux.join('\n\n');
}

/** Rend l'un des états financiers sous forme de tableau aligné. */
export function rendreEtat(r: Resultats, etat: string): string {
  const annees = r.exercices.map((e) => e.libelle);
  const l = ligneMontants;

  switch (etat) {
    case 'compte_resultat':
      return tableauTexte(
        ['Poste', ...annees],
        [
          l('Ventes de marchandises', r.compteResultat.map((c) => c.ventesMarchandises)),
          l('Production vendue', r.compteResultat.map((c) => c.production)),
          l('Chiffre d’affaires', r.compteResultat.map((c) => c.chiffreAffaires)),
          l('Subventions d’exploitation', r.compteResultat.map((c) => c.subventionsExploitation)),
          l('Achats de marchandises', r.compteResultat.map((c) => c.achatsMarchandises)),
          l('Variation de stock', r.compteResultat.map((c) => c.variationStock)),
          l('Achats de matières', r.compteResultat.map((c) => c.achatsMatieres)),
          l('Services extérieurs', r.compteResultat.map((c) => c.servicesExterieurs)),
          l('Autres services extérieurs', r.compteResultat.map((c) => c.autresServicesExterieurs)),
          l('Impôts et taxes', r.compteResultat.map((c) => c.impotsTaxes)),
          l('Salaires et rémunérations', r.compteResultat.map((c) => c.salairesBruts)),
          l('Charges sociales', r.compteResultat.map((c) => c.chargesSociales)),
          l('Dotations aux amortissements', r.compteResultat.map((c) => c.dotationsAmortissements)),
          l('RÉSULTAT D’EXPLOITATION', r.compteResultat.map((c) => c.resultatExploitation)),
          l('Charges financières', r.compteResultat.map((c) => c.chargesFinancieres)),
          l('Résultat courant', r.compteResultat.map((c) => c.resultatCourant)),
          l('Résultat exceptionnel', r.compteResultat.map((c) => c.resultatExceptionnel)),
          l('Impôt sur les sociétés', r.compteResultat.map((c) => c.impotSocietes)),
          l('RÉSULTAT NET', r.compteResultat.map((c) => c.resultatNet)),
        ],
      );

    case 'sig':
      return tableauTexte(
        ['Solde', ...annees],
        [
          l('Marge commerciale', r.sig.map((s) => s.margeCommerciale)),
          l('Production de l’exercice', r.sig.map((s) => s.production)),
          l('Consommations externes', r.sig.map((s) => s.consommationsExterieures)),
          l('VALEUR AJOUTÉE', r.sig.map((s) => s.valeurAjoutee)),
          l('Charges de personnel', r.sig.map((s) => s.chargesPersonnel)),
          l('EXCÉDENT BRUT D’EXPLOITATION', r.sig.map((s) => s.excedentBrutExploitation)),
          l('Résultat d’exploitation', r.sig.map((s) => s.resultatExploitation)),
          l('RÉSULTAT NET', r.sig.map((s) => s.resultatNet)),
        ],
      );

    case 'caf':
      return tableauTexte(
        ['Élément', ...annees],
        [
          l('Résultat net', r.caf.map((c) => c.resultatNet)),
          l('Dotations aux amortissements', r.caf.map((c) => c.dotations)),
          l('CAPACITÉ D’AUTOFINANCEMENT', r.caf.map((c) => c.caf)),
          l('Autofinancement net', r.caf.map((c) => c.autofinancementNet)),
        ],
      );

    case 'ratios':
      return tableauTexte(
        ['Ratio', ...annees, 'Unité'],
        r.ratios.map((ratio) => [
          ratio.libelle,
          ...ratio.valeurs.map((v) =>
            ratio.unite === '%' ? formaterPourcentage(v) : formaterMontant(v, ratio.unite === 'x' ? 2 : 0),
          ),
          ratio.unite,
        ]),
      );

    case 'seuil':
      return tableauTexte(
        ['Élément', ...annees],
        [
          l('Chiffre d’affaires', r.seuilRentabilite.map((s) => s.chiffreAffaires)),
          l('Charges variables', r.seuilRentabilite.map((s) => s.chargesVariables)),
          l('Marge sur coût variable', r.seuilRentabilite.map((s) => s.margeSurCoutVariable)),
          l('Charges fixes', r.seuilRentabilite.map((s) => s.chargesFixes)),
          l('SEUIL DE RENTABILITÉ', r.seuilRentabilite.map((s) => s.seuil)),
          l('Seuil financier', r.seuilRentabilite.map((s) => s.seuilFinancier)),
          ['Point mort (jours)', ...r.seuilRentabilite.map((s) => String(s.pointMortJours))],
        ],
      );

    case 'bfr':
      return tableauTexte(
        ['Poste', ...annees],
        [
          l('Stocks', r.bfr.map((b) => b.stocks)),
          l('Créances clients', r.bfr.map((b) => b.creancesClients)),
          l('Crédit de TVA', r.bfr.map((b) => b.creditTva)),
          l('Total des besoins', r.bfr.map((b) => b.totalBesoins)),
          l('Dettes fournisseurs', r.bfr.map((b) => b.dettesFournisseurs)),
          l('TVA à décaisser', r.bfr.map((b) => b.tvaADecaisser)),
          l('Dettes sociales', r.bfr.map((b) => b.dettesSociales)),
          l('Dettes fiscales', r.bfr.map((b) => b.dettesFiscales)),
          l('Total des ressources', r.bfr.map((b) => b.totalRessources)),
          l('BESOIN EN FONDS DE ROULEMENT', r.bfr.map((b) => b.bfr)),
          l('Variation', r.bfr.map((b) => b.variation)),
        ],
      );

    case 'plan_financement':
      return tableauTexte(
        ['Poste', ...annees],
        [
          l('Investissements', r.planFinancement.map((p) => p.besoins.investissements)),
          l('Remboursements d’emprunts', r.planFinancement.map((p) => p.besoins.remboursementsEmprunts)),
          l('Variation du BFR', r.planFinancement.map((p) => p.besoins.variationBfr)),
          l('Distributions', r.planFinancement.map((p) => p.besoins.distributions)),
          l('TOTAL DES BESOINS', r.planFinancement.map((p) => p.besoins.total)),
          l('Capacité d’autofinancement', r.planFinancement.map((p) => p.ressources.caf)),
          l('Apports', r.planFinancement.map((p) => p.ressources.apports)),
          l('Emprunts', r.planFinancement.map((p) => p.ressources.emprunts)),
          l('Subventions', r.planFinancement.map((p) => p.ressources.subventions)),
          l('TOTAL DES RESSOURCES', r.planFinancement.map((p) => p.ressources.total)),
          l('SOLDE', r.planFinancement.map((p) => p.solde)),
          l('Solde cumulé', r.planFinancement.map((p) => p.soldeCumule)),
        ],
      );

    case 'tresorerie':
      return tableauTexte(
        ['Mois', 'Encaissements', 'Décaissements', 'Variation', 'Solde'],
        r.tresorerie.mensuelle.map((m) => [
          m.libelle,
          euros(m.encaissements.total),
          euros(m.decaissements.total),
          euros(m.variation),
          euros(m.soldeFinal),
        ]),
      ) +
        `\n\nSolde le plus bas : ${euros(r.tresorerie.soldeMinimum)} € en ${r.libellesMois[r.tresorerie.moisSoldeMinimum] ?? ''}.`;

    case 'tva':
      if (r.tva.periodes.length === 0) return 'Le dossier n’est pas assujetti à la TVA.';
      return tableauTexte(
        ['Période', 'Collectée', 'Déd. biens et services', 'Déd. immobilisations', 'Solde', 'À décaisser'],
        r.tva.periodes.map((p) => [
          p.libelle,
          euros(p.collectee),
          euros(p.deductibleBiensServices),
          euros(p.deductibleImmobilisations),
          euros(p.solde),
          euros(p.aDecaisser),
        ]),
      );

    case 'bilan':
      return tableauTexte(
        ['Poste', ...annees],
        [
          l('Immobilisations nettes', r.bilans.map((b) => b.actif.immobilisationsNettes)),
          l('Stocks', r.bilans.map((b) => b.actif.stocks)),
          l('Créances clients', r.bilans.map((b) => b.actif.creancesClients)),
          l('Autres créances', r.bilans.map((b) => b.actif.autresCreances)),
          l('Disponibilités', r.bilans.map((b) => b.actif.disponibilites)),
          l('TOTAL DE L’ACTIF', r.bilans.map((b) => b.actif.total)),
          l('Capitaux propres', r.bilans.map((b) => b.passif.capitauxPropres)),
          l('Comptes courants', r.bilans.map((b) => b.passif.comptesCourants)),
          l('Emprunts', r.bilans.map((b) => b.passif.empruntsDettesFinancieres)),
          l('Dettes fournisseurs', r.bilans.map((b) => b.passif.dettesFournisseurs)),
          l('Dettes fiscales et sociales', r.bilans.map((b) => b.passif.dettesFiscalesSociales)),
          l('Autres dettes', r.bilans.map((b) => b.passif.autresDettes)),
          l('TOTAL DU PASSIF', r.bilans.map((b) => b.passif.total)),
          l('ÉCART', r.bilans.map((b) => b.ecart)),
        ],
      );

    case 'amortissements':
      return tableauTexte(
        ['Immobilisation', ...annees.map((a) => `Dotation ${a}`), 'VNC finale'],
        r.amortissements.map((p) => [
          `${p.libelle} (${p.dureeAnnees} ans)`,
          ...p.dotations.map(euros),
          euros(p.vnc[p.vnc.length - 1] ?? 0),
        ]),
      );

    case 'emprunts':
      if (r.emprunts.length === 0) return 'Aucun emprunt n’est saisi dans ce dossier.';
      return r.emprunts
        .map(
          (t) =>
            `${t.libelle} — ${euros(t.montant)} € sur ${t.dureeMois} mois à ${formaterPourcentage(t.tauxAnnuel, 2)}\n` +
            `Mensualité : ${formaterMontant(t.mensualite, 2)} €\n` +
            tableauTexte(
              ['Exercice', 'Capital', 'Intérêts', 'Assurance', 'Capital restant dû'],
              t.parExercice.map((p, i) => [
                annees[i] ?? String(i),
                euros(p.capital),
                euros(p.interets),
                euros(p.assurance),
                euros(p.capitalRestantDuFin),
              ]),
            ),
        )
        .join('\n\n');

    default:
      return `État inconnu : « ${etat} ».`;
  }
}

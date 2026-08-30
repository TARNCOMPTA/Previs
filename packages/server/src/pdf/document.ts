import {
  formaterMontant,
  formaterMontantOuVide,
  formaterPeriode,
  formaterPourcentage,
  LIBELLES_CATEGORIE_CHARGE,
  LIBELLES_CATEGORIE_INVESTISSEMENT,
  LIBELLES_STATUT_PERSONNEL,
  LIBELLES_TYPE_APPORT,
  type Dossier,
  type Resultats,
} from '@previs/core';
import { barresHorizontales, COULEURS, courbe, histogramme } from './graphiques.js';
import { STYLE } from './style.js';

const CABINET = {
  nom: 'TARN COMPTA',
  adresse: '70 Chemin de Mézard',
  ville: '81000 ALBI',
  telephone: '05.31.51.15.51',
  courriel: 'contact@tarncompta.fr',
  site: 'http://www.tarncompta.com',
};

function e(texte: unknown): string {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cellule de montant : un tiret pour zéro, la couleur rouge pour un négatif. */
function montant(valeur: number, options: { vide?: boolean; classe?: string } = {}): string {
  const texte = options.vide === false ? formaterMontant(valeur) : formaterMontantOuVide(valeur);
  const classes = [options.classe ?? '', valeur < 0 ? 'negatif' : ''].filter(Boolean).join(' ');
  return `<td${classes ? ` class="${classes}"` : ''}>${texte}</td>`;
}

interface OptionsLigne {
  classe?: string;
  detail?: boolean;
  pourcentage?: number[];
  vide?: boolean;
}

function ligne(libelle: string, valeurs: readonly number[], options: OptionsLigne = {}): string {
  const cellules = valeurs.map((v) => montant(v, { vide: options.vide })).join('');
  const pourcentages = (options.pourcentage ?? [])
    .map((p) => `<td>${Number.isFinite(p) ? formaterPourcentage(p) : '—'}</td>`)
    .join('');
  const classeLibelle = options.detail ? ' class="detail"' : '';
  return `<tr${options.classe ? ` class="${options.classe}"` : ''}><td${classeLibelle}>${e(libelle)}</td>${cellules}${pourcentages}</tr>`;
}

function tableau(entetes: readonly string[], corps: string, classe = ''): string {
  return `<table${classe ? ` class="${classe}"` : ''}><thead><tr>${entetes
    .map((h) => `<th>${e(h)}</th>`)
    .join('')}</tr></thead><tbody>${corps}</tbody></table>`;
}

/** Flèche stylisée de la charte, tracée en SVG pour rester nette à l'impression. */
function fleche(): string {
  return `<svg width="120" height="34" viewBox="0 0 120 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 17 L86 17" stroke="#5BC5C5" stroke-width="3" />
    <path d="M78 5 L100 17 L78 29 Z" fill="#5BC5C5" />
    <path d="M96 5 L118 17 L96 29 Z" fill="#FFFFFF" opacity="0.65" />
  </svg>`;
}

/** Construit le document HTML complet du dossier prévisionnel. */
export function construireHtml(
  dossier: Dossier,
  r: Resultats,
  options: { titre?: string } = {},
): string {
  const identite = dossier.identite;
  const exercices = r.exercices;
  const annees = exercices.map((x) => x.libelle);
  const n = exercices.length;
  const societe = identite.regime === 'IS';
  const periode = formaterPeriode(
    exercices[0]?.dateDebut ?? '',
    exercices[n - 1]?.dateFin ?? '',
  );
  const raison = identite.raisonSociale || options.titre || 'Dossier prévisionnel';

  const sections: Array<{ titre: string; contenu: string }> = [];
  const ajouter = (titre: string, contenu: string) => {
    if (contenu.trim()) sections.push({ titre, contenu });
  };

  // ─── Introduction ───────────────────────────────────────────────────────────
  const paragraphes = identite.introduction
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (identite.typeDossier === 'plan_continuation' && identite.rappelProcedure.trim()) {
    const rappel = identite.rappelProcedure
      .split(/\n\s*\n/)
      .map((p) => `<p class="intro">${e(p.trim())}</p>`)
      .join('');
    const passif = dossier.autres.passifDeclare.filter((l) => l.actif && l.montantDeclare > 0);
    const tablePassif = passif.length
      ? tableau(
          ['Créancier', 'Nature', 'Montant déclaré', ...annees],
          passif
            .map((l) => {
              const parExercice = Array.from({ length: n }, (_, i) =>
                l.echeances.filter((x) => x.exercice === i).reduce((t, x) => t + x.montant, 0),
              );
              return `<tr><td>${e(l.creancier || l.libelle)}</td><td>${e(l.nature)}</td>${montant(l.montantDeclare)}${parExercice
                .map((v) => montant(v))
                .join('')}</tr>`;
            })
            .join('') +
            ligne(
              'Total du passif déclaré',
              [
                passif.reduce((t, l) => t + l.montantDeclare, 0),
                ...Array.from({ length: n }, (_, i) =>
                  passif.reduce(
                    (t, l) =>
                      t + l.echeances.filter((x) => x.exercice === i).reduce((s, x) => s + x.montant, 0),
                    0,
                  ),
                ),
              ],
              { classe: 'total' },
            ),
        )
      : '';
    ajouter('Rappel de la procédure', rappel + tablePassif);
  }
  if (paragraphes.length) {
    ajouter('Introduction', paragraphes.map((p) => `<p class="intro">${e(p)}</p>`).join(''));
  }

  // ─── Investissements ────────────────────────────────────────────────────────
  const investissements = dossier.investissements.lignes.filter((l) => l.actif && l.montantHT !== 0);
  if (investissements.length) {
    const groupes = new Map<string, typeof investissements>();
    for (const l of investissements) {
      const liste = groupes.get(l.categorie) ?? [];
      liste.push(l);
      groupes.set(l.categorie, liste);
    }
    let corps = '';
    for (const [categorie, lignes] of groupes) {
      corps += `<tr class="groupe"><td colspan="5">${e(LIBELLES_CATEGORIE_INVESTISSEMENT[categorie as keyof typeof LIBELLES_CATEGORIE_INVESTISSEMENT] ?? categorie)}</td></tr>`;
      for (const l of lignes) {
        const duree =
          l.modeAmortissement === 'aucun' || l.dureeAmortissementAnnees === 0
            ? 'Non amortissable'
            : `${l.dureeAmortissementAnnees} ans (${l.modeAmortissement === 'degressif' ? 'dégressif' : 'linéaire'})`;
        corps += `<tr><td class="detail">${e(l.libelle)}</td>${montant(l.montantHT)}<td>${e(duree)}</td><td>${e(annees[l.exercice] ?? '')}</td><td>Mois ${l.mois}</td></tr>`;
      }
    }
    corps += ligne(
      'Total des investissements',
      [investissements.reduce((t, l) => t + l.montantHT, 0)],
      { classe: 'total' },
    ).replace('</tr>', '<td colspan="3"></td></tr>');

    const cessions = dossier.investissements.cessions.filter((c) => c.actif && c.prixCessionHT > 0);
    const tableCessions = cessions.length
      ? `<h3 class="sous-titre">Les cessions d’immobilisations prévues :</h3>` +
        tableau(
          ['Bien cédé', 'Exercice', 'Prix de cession HT', 'Valeur nette comptable', 'Plus ou moins-value'],
          cessions
            .map((c) => {
              const i = c.exercice;
              return `<tr><td>${e(c.libelle)}</td><td>${e(annees[i] ?? '')}</td>${montant(c.prixCessionHT)}${montant(r.bilans[i] ? 0 : 0)}${montant(0)}</tr>`;
            })
            .join(''),
        )
      : '';

    ajouter(
      'Les investissements',
      `<h3 class="sous-titre">Les investissements prévus sur la période :</h3>` +
        tableau(['Désignation', 'Montant HT', 'Amortissement', 'Exercice', 'Acquisition'], corps) +
        tableCessions,
    );
  }

  // ─── Financements ───────────────────────────────────────────────────────────
  const apports = dossier.financements.apports.filter((a) => a.actif && a.montant !== 0);
  const emprunts = dossier.financements.emprunts.filter((x) => x.actif && x.montant > 0);
  const subventions = dossier.financements.subventions.filter((s) => s.actif && s.montant !== 0);
  const creditsBaux = dossier.financements.creditsBaux.filter((c) => c.actif && c.loyerMensuelHT > 0);

  if (apports.length || emprunts.length || subventions.length || creditsBaux.length) {
    let corps = '';
    if (apports.length) {
      corps += `<tr class="groupe"><td colspan="3">Apports et comptes courants</td></tr>`;
      for (const a of apports) {
        corps += `<tr><td class="detail">${e(a.libelle)} — ${e(LIBELLES_TYPE_APPORT[a.type])}</td>${montant(a.montant)}<td>${e(annees[a.exercice] ?? '')}</td></tr>`;
      }
    }
    if (emprunts.length) {
      corps += `<tr class="groupe"><td colspan="3">Emprunts</td></tr>`;
      for (const x of emprunts) {
        corps += `<tr><td class="detail">${e(x.libelle)}${x.organisme ? ` — ${e(x.organisme)}` : ''} (${formaterPourcentage(x.tauxAnnuel, 2)} sur ${x.dureeMois} mois)</td>${montant(x.montant)}<td>${e(annees[x.exerciceDeblocage] ?? '')}</td></tr>`;
      }
    }
    if (subventions.length) {
      corps += `<tr class="groupe"><td colspan="3">Subventions</td></tr>`;
      for (const s of subventions) {
        corps += `<tr><td class="detail">${e(s.libelle)}${s.organisme ? ` — ${e(s.organisme)}` : ''}</td>${montant(s.montant)}<td>${e(annees[s.exercice] ?? '')}</td></tr>`;
      }
    }
    const totalRessources =
      apports.reduce((t, a) => t + a.montant, 0) +
      emprunts.reduce((t, x) => t + x.montant, 0) +
      subventions.reduce((t, s) => t + s.montant, 0);
    corps += `<tr class="total"><td>Total des ressources</td>${montant(totalRessources)}<td></td></tr>`;

    const plan = r.planFinancement[0];
    const ecart = plan ? plan.ressources.total - plan.besoins.total : 0;
    const encadre = plan
      ? `<div class="encadre${ecart < 0 ? ' alerte' : ''}">
           <h3>Équilibre du financement au démarrage</h3>
           <p>Besoins du premier exercice : <strong>${formaterMontant(plan.besoins.total)} €</strong> —
              Ressources mobilisées : <strong>${formaterMontant(plan.ressources.total)} €</strong>.
              ${
                ecart < 0
                  ? `Il manque <strong>${formaterMontant(-ecart)} €</strong> pour équilibrer le plan de financement.`
                  : `Le plan de financement dégage une marge de <strong>${formaterMontant(ecart)} €</strong>.`
              }</p>
         </div>`
      : '';

    const tableCb = creditsBaux.length
      ? `<h3 class="sous-titre">Les contrats de crédit-bail :</h3>` +
        tableau(
          ['Contrat', 'Valeur du bien', 'Loyer mensuel HT', 'Durée', 'Dépôt de garantie'],
          creditsBaux
            .map(
              (c) =>
                `<tr><td>${e(c.libelle)}${c.organisme ? ` — ${e(c.organisme)}` : ''}</td>${montant(c.valeurBien)}${montant(c.loyerMensuelHT)}<td>${c.dureeMois} mois</td>${montant(c.depotGarantie)}</tr>`,
            )
            .join(''),
        )
      : '';

    ajouter(
      'Les financements',
      encadre +
        `<h3 class="sous-titre">Les ressources de financement mobilisées :</h3>` +
        tableau(['Nature', 'Montant', 'Exercice'], corps) +
        tableCb,
    );
  }

  // ─── Tableaux d'amortissement des emprunts ──────────────────────────────────
  const tableauxEmprunts = r.emprunts.filter((t) => t.montant > 0);
  if (tableauxEmprunts.length) {
    const blocs = tableauxEmprunts
      .map((t) => {
        const corps = t.parExercice
          .map((p, i) =>
            `<tr><td>${e(annees[i] ?? '')}</td>${montant(p.capital)}${montant(p.interets)}${montant(p.assurance)}${montant(euroSomme(p.capital, p.interets, p.assurance))}${montant(p.capitalRestantDuFin)}</tr>`,
          )
          .join('');
        const cout = t.echeances.reduce((s, x) => s + x.interets + x.assurance, 0);
        return (
          `<h3 class="sous-titre">${e(t.libelle)} — ${formaterMontant(t.montant)} € sur ${t.dureeMois} mois au taux de ${formaterPourcentage(t.tauxAnnuel, 2)}</h3>` +
          `<p>Mensualité hors assurance : <strong>${formaterMontant(t.mensualite, 2)} €</strong>. Coût total du crédit sur la période : <strong>${formaterMontant(cout)} €</strong>.</p>` +
          tableau(
            ['Exercice', 'Capital remboursé', 'Intérêts', 'Assurance', 'Total réglé', 'Capital restant dû'],
            corps,
          )
        );
      })
      .join('');
    ajouter('Les emprunts', blocs);
  }

  // ─── Chiffre d'affaires ─────────────────────────────────────────────────────
  if (r.recettes.detail.length) {
    const corps =
      r.recettes.detail
        .map((d) => ligne(d.libelle, d.montants, { detail: true }))
        .join('') +
      ligne('Total du chiffre d’affaires', r.recettes.caParExercice, { classe: 'total' });

    const croissance = r.recettes.caParExercice.map((ca, i) =>
      i === 0 || !r.recettes.caParExercice[i - 1]
        ? 0
        : ((ca - r.recettes.caParExercice[i - 1]) / r.recettes.caParExercice[i - 1]) * 100,
    );

    ajouter(
      'Le chiffre d’affaires prévisionnel',
      `<h3 class="sous-titre">La ventilation du chiffre d’affaires par activité :</h3>` +
        tableau(['Activité', ...annees], corps) +
        ligneCroissance(annees, croissance) +
        histogramme(annees, [
          { libelle: 'Chiffre d’affaires', valeurs: r.recettes.caParExercice, couleur: COULEURS.turquoise },
          { libelle: 'Résultat net', valeurs: r.compteResultat.map((c) => c.resultatNet), couleur: COULEURS.orange },
        ]),
    );
  }

  // ─── Personnel ──────────────────────────────────────────────────────────────
  const personnel = r.charges.personnel.filter((p) => p.brut.some((v) => v !== 0));
  if (personnel.length) {
    let corps = '';
    for (const p of personnel) {
      corps += ligne(
        `${p.libelle} — ${LIBELLES_STATUT_PERSONNEL[p.statut as keyof typeof LIBELLES_STATUT_PERSONNEL] ?? p.statut}`,
        p.brut,
        { detail: true },
      );
      if (p.charges.some((v) => v !== 0)) {
        corps += ligne('dont charges sociales', p.charges, { detail: true });
      }
    }
    const totalBrut = sommeParExercice(personnel.map((p) => (p.nonDeductible ? p.brut.map(() => 0) : p.brut)), n);
    const totalCharges = sommeParExercice(personnel.map((p) => p.charges), n);
    corps += ligne('Total de la masse salariale chargée', totalBrut.map((v, i) => v + totalCharges[i]), {
      classe: 'total',
    });

    const note = personnel.some((p) => p.nonDeductible)
      ? `<div class="encadre"><p>Les prélèvements de l’exploitant ne constituent pas une charge déductible du résultat : seules les cotisations sociales le sont. Ils figurent ici pour mémoire et sont repris au tableau de trésorerie.</p></div>`
      : '';

    ajouter(
      'Les charges de personnel',
      note +
        `<h3 class="sous-titre">Les rémunérations et charges sociales prévues :</h3>` +
        tableau(['Poste', ...annees], corps),
    );
  }

  // ─── Charges externes ───────────────────────────────────────────────────────
  const chargesExternes = r.charges.detail.filter((d) => d.montants.some((v) => v !== 0));
  if (chargesExternes.length) {
    const groupes = new Map<string, typeof chargesExternes>();
    for (const d of chargesExternes) {
      const liste = groupes.get(d.categorie) ?? [];
      liste.push(d);
      groupes.set(d.categorie, liste);
    }
    let corps = '';
    for (const [categorie, lignes] of groupes) {
      corps += `<tr class="groupe"><td colspan="${n + 1}">${e(LIBELLES_CATEGORIE_CHARGE[categorie as keyof typeof LIBELLES_CATEGORIE_CHARGE] ?? categorie)}</td></tr>`;
      for (const d of lignes) corps += ligne(d.libelle, d.montants, { detail: true });
      corps += ligne(
        'Sous-total',
        sommeParExercice(lignes.map((l) => l.montants), n),
        { classe: 'sous-total' },
      );
    }
    corps += ligne('Total des charges externes', r.charges.totalParExercice, { classe: 'total' });

    const repartition = [...groupes.entries()].map(([categorie, lignes]) => ({
      libelle:
        LIBELLES_CATEGORIE_CHARGE[categorie as keyof typeof LIBELLES_CATEGORIE_CHARGE] ?? categorie,
      valeur: sommeParExercice(lignes.map((l) => l.montants), n)[0] ?? 0,
    }));

    ajouter(
      'Les charges externes et impôts et taxes',
      `<h3 class="sous-titre">Le détail des charges d’exploitation :</h3>` +
        tableau(['Poste', ...annees], corps) +
        `<h3 class="sous-titre">La répartition des charges du premier exercice :</h3>` +
        barresHorizontales(repartition),
    );
  }

  // ─── Dotations aux amortissements ───────────────────────────────────────────
  const plans = r.amortissements.filter((p) => p.dotations.some((d) => d !== 0));
  if (plans.length) {
    const corps =
      plans.map((p) => ligne(`${p.libelle} (${p.dureeAnnees} ans)`, p.dotations, { detail: true })).join('') +
      ligne(
        'Total des dotations',
        r.compteResultat.map((c) => c.dotationsAmortissements),
        { classe: 'total' },
      ) +
      ligne('Valeur nette comptable à la clôture', sommeParExercice(plans.map((p) => p.vnc), n), {
        classe: 'sous-total',
      });
    ajouter(
      'Les dotations aux amortissements',
      `<h3 class="sous-titre">Les dotations par immobilisation :</h3>` +
        tableau(['Immobilisation', ...annees], corps),
    );
  }

  // ─── Compte de résultat ─────────────────────────────────────────────────────
  {
    const c = r.compteResultat;
    const pct = (valeurs: number[]) =>
      valeurs.map((v, i) => (c[i].chiffreAffaires ? (v / c[i].chiffreAffaires) * 100 : 0));
    const l = (libelle: string, extraire: (x: (typeof c)[number]) => number, classe?: string) =>
      ligne(libelle, c.map(extraire), { classe, detail: !classe });

    const corps = [
      `<tr class="groupe"><td colspan="${n + 1}">Produits d’exploitation</td></tr>`,
      l('Ventes de marchandises', (x) => x.ventesMarchandises),
      l('Production vendue', (x) => x.production),
      l('Subventions d’exploitation', (x) => x.subventionsExploitation),
      l('Autres produits', (x) => x.autresProduits),
      l('Total des produits d’exploitation', (x) => x.totalProduitsExploitation, 'sous-total'),
      `<tr class="groupe"><td colspan="${n + 1}">Charges d’exploitation</td></tr>`,
      l('Achats de marchandises', (x) => x.achatsMarchandises),
      l('Variation de stock', (x) => x.variationStock),
      l('Achats de matières premières', (x) => x.achatsMatieres),
      l('Autres achats et fournitures', (x) => x.autresAchats),
      l('Sous-traitance', (x) => x.sousTraitance),
      l('Services extérieurs', (x) => x.servicesExterieurs),
      l('Autres services extérieurs', (x) => x.autresServicesExterieurs),
      l('Impôts, taxes et versements assimilés', (x) => x.impotsTaxes),
      l('Salaires et rémunérations', (x) => x.salairesBruts),
      l('Charges sociales', (x) => x.chargesSociales),
      l('Dotations aux amortissements', (x) => x.dotationsAmortissements),
      l('Autres charges', (x) => x.autresCharges),
      l('Total des charges d’exploitation', (x) => x.totalChargesExploitation, 'sous-total'),
      ligne('RÉSULTAT D’EXPLOITATION', c.map((x) => x.resultatExploitation), {
        classe: 'total',
        pourcentage: pct(c.map((x) => x.resultatExploitation)),
      }),
      l('Charges financières', (x) => x.chargesFinancieres),
      ligne('RÉSULTAT COURANT AVANT IMPÔT', c.map((x) => x.resultatCourant), { classe: 'sous-total' }),
      l('Produits exceptionnels', (x) => x.produitsExceptionnels),
      l('Charges exceptionnelles', (x) => x.chargesExceptionnelles),
      l(societe ? 'Impôt sur les sociétés' : 'Impôt sur le revenu estimé (hors résultat)', (x) =>
        societe ? x.impotSocietes : x.impotRevenuEstime,
      ),
      ligne('RÉSULTAT NET', c.map((x) => x.resultatNet), {
        classe: 'total',
        pourcentage: pct(c.map((x) => x.resultatNet)),
      }),
    ].join('');

    ajouter(
      'Le compte de résultat prévisionnel',
      tableau(['Poste', ...annees, '% du CA'], corps) +
        `<div class="indicateurs">
          <div class="indicateur"><div class="valeur">${formaterMontant(c[n - 1]?.chiffreAffaires ?? 0)} €</div><div class="libelle">Chiffre d’affaires ${e(annees[n - 1] ?? '')}</div></div>
          <div class="indicateur"><div class="valeur">${formaterMontant(c[n - 1]?.resultatNet ?? 0)} €</div><div class="libelle">Résultat net ${e(annees[n - 1] ?? '')}</div></div>
          <div class="indicateur"><div class="valeur">${formaterMontant(r.tresorerie.soldeMinimum)} €</div><div class="libelle">Trésorerie la plus basse</div></div>
        </div>`,
    );
  }

  // ─── SIG et CAF ─────────────────────────────────────────────────────────────
  {
    const s = r.sig;
    const l = (libelle: string, extraire: (x: (typeof s)[number]) => number, classe?: string) =>
      ligne(libelle, s.map(extraire), { classe, detail: !classe });
    const corps = [
      l('Marge commerciale', (x) => x.margeCommerciale),
      l('Production de l’exercice', (x) => x.production),
      l('Consommations en provenance de tiers', (x) => x.consommationsExterieures),
      ligne('VALEUR AJOUTÉE', s.map((x) => x.valeurAjoutee), { classe: 'sous-total' }),
      l('Subventions d’exploitation', (x) => x.subventions),
      l('Impôts et taxes', (x) => x.impotsTaxes),
      l('Charges de personnel', (x) => x.chargesPersonnel),
      ligne('EXCÉDENT BRUT D’EXPLOITATION', s.map((x) => x.excedentBrutExploitation), { classe: 'sous-total' }),
      l('Dotations aux amortissements', (x) => x.dotations),
      ligne('RÉSULTAT D’EXPLOITATION', s.map((x) => x.resultatExploitation), { classe: 'sous-total' }),
      ligne('RÉSULTAT NET', s.map((x) => x.resultatNet), { classe: 'total' }),
    ].join('');

    const caf = r.caf;
    const corpsCaf = [
      ligne('Résultat net', caf.map((x) => x.resultatNet), { detail: true }),
      ligne('Dotations aux amortissements', caf.map((x) => x.dotations), { detail: true }),
      ligne('Reprises de subventions', caf.map((x) => -x.repriseSubventions), { detail: true }),
      ligne('Plus-values de cession', caf.map((x) => -x.plusValuesCession), { detail: true }),
      ligne('CAPACITÉ D’AUTOFINANCEMENT', caf.map((x) => x.caf), { classe: 'total' }),
      ligne('Autofinancement net des remboursements', caf.map((x) => x.autofinancementNet), {
        classe: 'sous-total',
      }),
    ].join('');

    ajouter(
      'Les soldes intermédiaires de gestion',
      tableau(['Solde', ...annees], corps) +
        `<h3 class="sous-titre">La capacité d’autofinancement :</h3>` +
        tableau(['Élément', ...annees], corpsCaf),
    );
  }

  // ─── Ratios et seuil ────────────────────────────────────────────────────────
  {
    const corps = r.ratios
      .map((ratio) => {
        const cellules = ratio.valeurs
          .map((v) => {
            const texte =
              ratio.unite === '%'
                ? formaterPourcentage(v)
                : ratio.unite === 'jours'
                  ? `${formaterMontant(v)} j`
                  : ratio.unite === 'x'
                    ? formaterMontant(v, 2)
                    : formaterMontant(v);
            return `<td${v < 0 ? ' class="negatif"' : ''}>${texte}</td>`;
          })
          .join('');
        return `<tr><td class="detail">${e(ratio.libelle)}</td>${cellules}</tr>`;
      })
      .join('');

    const s = r.seuilRentabilite;
    const corpsSeuil = [
      ligne('Chiffre d’affaires', s.map((x) => x.chiffreAffaires), { detail: true }),
      ligne('Charges variables', s.map((x) => x.chargesVariables), { detail: true }),
      ligne('Marge sur coût variable', s.map((x) => x.margeSurCoutVariable), { classe: 'sous-total' }),
      `<tr><td class="detail">Taux de marge sur coût variable</td>${s.map((x) => `<td>${formaterPourcentage(x.tauxMargeSurCoutVariable)}</td>`).join('')}</tr>`,
      ligne('Charges fixes', s.map((x) => x.chargesFixes), { detail: true }),
      ligne('SEUIL DE RENTABILITÉ', s.map((x) => x.seuil), { classe: 'total' }),
      ligne('Seuil de rentabilité financier', s.map((x) => x.seuilFinancier), { classe: 'sous-total' }),
      `<tr><td class="detail">Point mort</td>${s.map((x) => `<td>${x.pointMortJours} jours</td>`).join('')}</tr>`,
      ligne('Marge de sécurité', s.map((x) => x.margeSecurite), { detail: true }),
    ].join('');

    ajouter(
      'Les ratios et le seuil de rentabilité',
      `<h3 class="sous-titre">Les ratios d’exploitation et de structure :</h3>` +
        tableau(['Ratio', ...annees], corps) +
        `<h3 class="sous-titre">Le seuil de rentabilité :</h3>` +
        tableau(['Élément', ...annees], corpsSeuil) +
        histogramme(annees, [
          { libelle: 'Chiffre d’affaires', valeurs: s.map((x) => x.chiffreAffaires), couleur: COULEURS.turquoise },
          { libelle: 'Seuil de rentabilité', valeurs: s.map((x) => x.seuil), couleur: COULEURS.orange },
        ]),
    );
  }

  // ─── BFR et plan de financement ─────────────────────────────────────────────
  {
    const b = r.bfr;
    const corps = [
      `<tr class="groupe"><td colspan="${n + 1}">Besoins d’exploitation</td></tr>`,
      ligne('Stocks', b.map((x) => x.stocks), { detail: true }),
      ligne('Créances clients', b.map((x) => x.creancesClients), { detail: true }),
      ligne('Crédit de TVA', b.map((x) => x.creditTva), { detail: true }),
      ligne('Autres créances', b.map((x) => x.autresCreances), { detail: true }),
      ligne('Total des besoins', b.map((x) => x.totalBesoins), { classe: 'sous-total' }),
      `<tr class="groupe"><td colspan="${n + 1}">Ressources d’exploitation</td></tr>`,
      ligne('Dettes fournisseurs', b.map((x) => x.dettesFournisseurs), { detail: true }),
      ligne('TVA à décaisser', b.map((x) => x.tvaADecaisser), { detail: true }),
      ligne('Dettes sociales', b.map((x) => x.dettesSociales), { detail: true }),
      ligne('Dettes fiscales', b.map((x) => x.dettesFiscales), { detail: true }),
      ligne('Autres dettes', b.map((x) => x.autresDettes), { detail: true }),
      ligne('Total des ressources', b.map((x) => x.totalRessources), { classe: 'sous-total' }),
      ligne('BESOIN EN FONDS DE ROULEMENT', b.map((x) => x.bfr), { classe: 'total' }),
      ligne('Variation de l’exercice', b.map((x) => x.variation), { detail: true }),
      `<tr><td class="detail">Exprimé en jours de chiffre d’affaires</td>${b.map((x) => `<td>${x.enJoursCA} j</td>`).join('')}</tr>`,
    ].join('');

    const pf = r.planFinancement;
    const corpsPf = [
      `<tr class="groupe"><td colspan="${n + 1}">Besoins</td></tr>`,
      ligne('Investissements', pf.map((x) => x.besoins.investissements), { detail: true }),
      ligne('Remboursements d’emprunts', pf.map((x) => x.besoins.remboursementsEmprunts), { detail: true }),
      ligne('Remboursements de comptes courants', pf.map((x) => x.besoins.remboursementsComptesCourants), { detail: true }),
      ligne('Variation du besoin en fonds de roulement', pf.map((x) => x.besoins.variationBfr), { detail: true }),
      ligne('Distributions et prélèvements', pf.map((x) => x.besoins.distributions), { detail: true }),
      ligne('Total des besoins', pf.map((x) => x.besoins.total), { classe: 'sous-total' }),
      `<tr class="groupe"><td colspan="${n + 1}">Ressources</td></tr>`,
      ligne('Capacité d’autofinancement', pf.map((x) => x.ressources.caf), { detail: true }),
      ligne('Apports et comptes courants', pf.map((x) => x.ressources.apports), { detail: true }),
      ligne('Emprunts', pf.map((x) => x.ressources.emprunts), { detail: true }),
      ligne('Subventions', pf.map((x) => x.ressources.subventions), { detail: true }),
      ligne('Cessions d’immobilisations', pf.map((x) => x.ressources.cessions), { detail: true }),
      ligne('Total des ressources', pf.map((x) => x.ressources.total), { classe: 'sous-total' }),
      ligne('SOLDE DE L’EXERCICE', pf.map((x) => x.solde), { classe: 'total' }),
      ligne('Solde cumulé', pf.map((x) => x.soldeCumule), { classe: 'sous-total' }),
    ].join('');

    ajouter(
      'Le besoin en fonds de roulement',
      tableau(['Poste', ...annees], corps),
    );
    ajouter('Le plan de financement', tableau(['Poste', ...annees], corpsPf));
  }

  // ─── Bilans ─────────────────────────────────────────────────────────────────
  {
    const b = r.bilans;
    const corps = [
      `<tr class="groupe"><td colspan="${n + 1}">ACTIF</td></tr>`,
      ligne('Immobilisations incorporelles', b.map((x) => x.actif.immobilisationsIncorporelles), { detail: true }),
      ligne('Immobilisations corporelles', b.map((x) => x.actif.immobilisationsCorporelles), { detail: true }),
      ligne('Immobilisations financières', b.map((x) => x.actif.immobilisationsFinancieres), { detail: true }),
      ligne('Amortissements cumulés', b.map((x) => -x.actif.amortissements), { detail: true }),
      ligne('Immobilisations nettes', b.map((x) => x.actif.immobilisationsNettes), { classe: 'sous-total' }),
      ligne('Stocks', b.map((x) => x.actif.stocks), { detail: true }),
      ligne('Créances clients', b.map((x) => x.actif.creancesClients), { detail: true }),
      ligne('Autres créances', b.map((x) => x.actif.autresCreances), { detail: true }),
      ligne('Disponibilités', b.map((x) => x.actif.disponibilites), { detail: true }),
      ligne('TOTAL DE L’ACTIF', b.map((x) => x.actif.total), { classe: 'total' }),
      `<tr class="groupe"><td colspan="${n + 1}">PASSIF</td></tr>`,
      ligne(societe ? 'Capital social' : 'Compte de l’exploitant', b.map((x) => x.passif.capitalSocial), { detail: true }),
      ...(societe
        ? [
            ligne('Primes et réserves', b.map((x) => x.passif.primesEtReserves), { detail: true }),
            ligne('Report à nouveau', b.map((x) => x.passif.reportANouveau), { detail: true }),
          ]
        : []),
      ligne('Résultat de l’exercice', b.map((x) => x.passif.resultatExercice), { detail: true }),
      ligne('Subventions d’investissement', b.map((x) => x.passif.subventionsInvestissement), { detail: true }),
      ligne('Capitaux propres', b.map((x) => x.passif.capitauxPropres), { classe: 'sous-total' }),
      ligne('Comptes courants d’associés', b.map((x) => x.passif.comptesCourants), { detail: true }),
      ligne('Emprunts et dettes financières', b.map((x) => x.passif.empruntsDettesFinancieres), { detail: true }),
      ligne('Dettes fournisseurs', b.map((x) => x.passif.dettesFournisseurs), { detail: true }),
      ligne('Dettes fiscales et sociales', b.map((x) => x.passif.dettesFiscalesSociales), { detail: true }),
      ligne('Autres dettes', b.map((x) => x.passif.autresDettes), { detail: true }),
      ligne('TOTAL DU PASSIF', b.map((x) => x.passif.total), { classe: 'total' }),
      ...(b.some((x) => Math.abs(x.ecart) > 1)
        ? [ligne('ÉCART ACTIF / PASSIF', b.map((x) => x.ecart), { classe: 'total' })]
        : []),
    ].join('');

    ajouter('Les bilans prévisionnels', tableau(['Poste', ...annees], corps));
  }

  // ─── Annexe trésorerie ──────────────────────────────────────────────────────
  {
    const blocs = exercices
      .map((x) => {
        const mois = r.tresorerie.mensuelle.slice(x.moisDebutAbsolu, x.moisDebutAbsolu + x.nbMois);
        const entetes = ['Poste', ...mois.map((m) => m.libelle), 'Total'];
        const l = (libelle: string, extraire: (m: (typeof mois)[number]) => number, classe?: string) => {
          const valeurs = mois.map(extraire);
          const total = valeurs.reduce((t, v) => t + v, 0);
          return ligne(libelle, [...valeurs, total], { classe, detail: !classe });
        };
        const corps = [
          l('Solde initial', (m) => m.soldeInitial, 'sous-total'),
          `<tr class="groupe"><td colspan="${mois.length + 2}">Encaissements</td></tr>`,
          l('Ventes encaissées', (m) => m.encaissements.ventes),
          l('Apports', (m) => m.encaissements.apports),
          l('Emprunts', (m) => m.encaissements.emprunts),
          l('Subventions', (m) => m.encaissements.subventions),
          l('Cessions', (m) => m.encaissements.cessions),
          l('Remboursements de TVA', (m) => m.encaissements.tvaRemboursee),
          l('Autres encaissements', (m) => m.encaissements.autres),
          l('Total des encaissements', (m) => m.encaissements.total, 'sous-total'),
          `<tr class="groupe"><td colspan="${mois.length + 2}">Décaissements</td></tr>`,
          l('Achats et charges', (m) => m.decaissements.achatsEtCharges),
          l('Rémunérations', (m) => m.decaissements.salaires),
          l('Charges sociales', (m) => m.decaissements.chargesSociales),
          l('Investissements', (m) => m.decaissements.investissements),
          l('Échéances d’emprunts', (m) => m.decaissements.echeancesEmprunts),
          l('TVA', (m) => m.decaissements.tva),
          l('Impôts et taxes', (m) => m.decaissements.impots),
          l('Distributions', (m) => m.decaissements.distributions),
          l('Autres décaissements', (m) => m.decaissements.autres),
          l('Total des décaissements', (m) => m.decaissements.total, 'sous-total'),
          l('SOLDE FINAL', (m) => m.soldeFinal, 'total'),
        ].join('');
        return `<h3 class="sous-titre">Exercice ${e(x.libelle)}</h3>` + tableau(entetes, corps, 'compacte');
      })
      .join('');

    ajouter(
      'Annexe — la trésorerie mensuelle',
      courbe(
        r.libellesMois,
        r.tresorerie.mensuelle.map((m) => m.soldeFinal),
      ) + blocs,
    );
  }

  // ─── Annexe TVA ─────────────────────────────────────────────────────────────
  if (r.tva.periodes.length) {
    const corps = r.tva.periodes
      .map(
        (p) =>
          `<tr><td>${e(p.libelle)}</td>${montant(p.collectee)}${montant(p.deductibleBiensServices)}${montant(p.deductibleImmobilisations)}${montant(p.solde)}${montant(p.creditReporte)}${montant(p.aDecaisser)}</tr>`,
      )
      .join('');
    const totaux = r.tva.periodes.reduce(
      (t, p) => ({
        collectee: t.collectee + p.collectee,
        bs: t.bs + p.deductibleBiensServices,
        immo: t.immo + p.deductibleImmobilisations,
        solde: t.solde + p.solde,
        decaisser: t.decaisser + p.aDecaisser,
      }),
      { collectee: 0, bs: 0, immo: 0, solde: 0, decaisser: 0 },
    );
    ajouter(
      'Annexe — la TVA',
      tableau(
        ['Période', 'TVA collectée', 'Déductible biens et services', 'Déductible immobilisations', 'Solde', 'Crédit reporté', 'À décaisser'],
        corps +
          `<tr class="total"><td>Total de la période</td>${montant(totaux.collectee)}${montant(totaux.bs)}${montant(totaux.immo)}${montant(totaux.solde)}<td>—</td>${montant(totaux.decaisser)}</tr>`,
        'compacte',
      ),
    );
  }

  // ─── Points de vigilance ────────────────────────────────────────────────────
  const erreurs = r.controles.filter((c) => !c.ok && c.gravite === 'erreur');
  const avertissements = r.controles.filter((c) => !c.ok && c.gravite === 'avertissement');
  const vigilance =
    erreurs.length || avertissements.length
      ? `<div class="encadre${erreurs.length ? ' alerte' : ''}">
          <h3>Points de vigilance</h3>
          <ul>${[...erreurs, ...avertissements]
            .map(
              (c) =>
                `<li><strong>${e(c.libelle)}${c.exercice !== undefined ? ` — ${e(annees[c.exercice] ?? '')}` : ''} :</strong> ${e(c.message)}</li>`,
            )
            .join('')}</ul>
        </div>`
      : '';

  // ─── Assemblage ─────────────────────────────────────────────────────────────
  const sommaire = `<ol class="sommaire">${sections.map((s) => `<li>${e(s.titre)}</li>`).join('')}</ol>`;
  const corpsSections = sections
    .map(
      (s, i) =>
        `<section${i === 0 ? '' : ' class="nouvelle-page"'}><h2 class="titre-section">${i + 1}. ${e(s.titre).toUpperCase()}</h2>${s.contenu}</section>`,
    )
    .join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(raison)} — Dossier prévisionnel</title><style>${STYLE}</style></head><body>
<div class="couverture">
  <h1>DOSSIER PRÉVISIONNEL</h1>
  <div class="sous-titre">${e(periode)}</div>
  <div class="activite">${e(identite.activite)}</div>
  <div class="fleche">${fleche()}</div>
  <div class="blocs">
    <div>
      <h2>Établi pour</h2>
      <p class="nom">${e(raison)}</p>
      <p>${e(identite.formeJuridique)}</p>
      ${identite.adresse.voie ? `<p>${e(identite.adresse.voie)}</p>` : ''}
      ${identite.adresse.codePostal || identite.adresse.ville ? `<p>${e(identite.adresse.codePostal)} ${e(identite.adresse.ville)}</p>` : ''}
      ${identite.dirigeants.map((d) => `<p>${e(d.nom)} — ${e(d.fonction)}</p>`).join('')}
    </div>
    <div>
      <h2>Établi par</h2>
      <p class="nom">${CABINET.nom}</p>
      <p>${CABINET.adresse}</p>
      <p>${CABINET.ville}</p>
      <p>${CABINET.telephone}</p>
      <p>${CABINET.courriel}</p>
    </div>
  </div>
</div>

<section>
  <h2 class="titre-section">SOMMAIRE</h2>
  ${sommaire}
  ${vigilance}
</section>

${corpsSections}

<div class="coordonnees">
  <div class="nom">${CABINET.nom}</div>
  <p>${CABINET.adresse}</p>
  <p>${CABINET.ville}</p>
  <p>${CABINET.telephone}</p>
  <p>${CABINET.courriel}</p>
  <p>${CABINET.site}</p>
  <div class="mention">
    Le présent dossier prévisionnel a été établi à partir des hypothèses communiquées par le client.<br>
    Ces projections sont estimatives et reposent sur des hypothèses raisonnables à la date de leur établissement ;<br>
    elles ne constituent ni une garantie de résultat, ni un engagement du cabinet.
  </div>
</div>
</body></html>`;
}

function euroSomme(...valeurs: number[]): number {
  return Math.round(valeurs.reduce((t, v) => t + v, 0) * 100) / 100;
}

function sommeParExercice(series: ReadonlyArray<readonly number[]>, n: number): number[] {
  return Array.from({ length: n }, (_, i) => series.reduce((t, s) => t + (s[i] ?? 0), 0));
}

function ligneCroissance(annees: readonly string[], croissance: readonly number[]): string {
  if (croissance.every((c) => c === 0)) return '';
  return `<p>Croissance d’un exercice à l’autre : ${annees
    .map((a, i) => (i === 0 ? null : `${a} ${formaterPourcentage(croissance[i])}`))
    .filter(Boolean)
    .join(', ')}.</p>`;
}

/**
 * Gabarit d'en-tête répété par Chromium sur chaque page à marges.
 *
 * Les styles doivent être en ligne : le gabarit est rendu dans un document isolé qui
 * n'hérite ni de la feuille de style du dossier, ni de son ajustement des couleurs.
 */
export function construireEntete(dossier: Dossier, r: Resultats): string {
  const identite = dossier.identite;
  const periode = formaterPeriode(
    r.exercices[0]?.dateDebut ?? '',
    r.exercices[r.exercices.length - 1]?.dateFin ?? '',
  );
  const raison = identite.raisonSociale || 'Dossier prévisionnel';
  return `<div style="width:100%;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="background:#1E3FCC;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;
                padding:3.5mm 14mm;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:bold;letter-spacing:0.3px;">${e(raison)}</span>
      <span style="opacity:0.88;">${e(identite.activite)}</span>
      <span style="opacity:0.88;">${e(periode)}</span>
    </div>
  </div>`;
}

/** Gabarit de pied de page, avec la pagination fournie par Chromium. */
export function construirePied(): string {
  return `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:6.8pt;color:#5A6272;
              padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">
    <span>${CABINET.nom} — ${CABINET.adresse}, ${CABINET.ville} — ${CABINET.telephone}</span>
    <span>Document établi à partir des hypothèses communiquées par le client</span>
    <span>PAGE <span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`;
}

import {
  formaterPeriode,
  LIBELLES_CATEGORIE_CHARGE,
  LIBELLES_CATEGORIE_INVESTISSEMENT,
  LIBELLES_STATUT_PERSONNEL,
  LIBELLES_TYPE_APPORT,
  type Dossier,
  type Resultats,
} from '@previs/core';
import { adresseSurUneLigne, CABINET_PAR_DEFAUT, type Cabinet } from '@previs/core';
import { COULEURS, courbe, histogramme } from './graphiques.js';
import {
  cartouches,
  carte,
  celluleMontant,
  e,
  encadre,
  grille,
  indicateurs,
  jauges,
  ligne as ligneComposant,
  sommaire as sommaireComposant,
  tableau as tableauComposant,
  tableauBrut as tableauBrutComposant,
  titreSection,
  triangleVariation,
  type LignePdf,
} from './composants.js';
import { eur, jours, mont, nombre, pct } from './nombres.js';
import { REGLES_POLICES_PIED } from './polices.js';
import { STYLE } from './style.js';

/**
 * Options de rendu du document.
 *
 * Le cabinet et le logo du client sont fournis par l'appelant : rien de l'identité
 * du cabinet n'est plus écrit en dur, le logiciel peut donc servir un autre cabinet
 * sans être recompilé.
 */
export interface OptionsDocument {
  titre?: string;
  cabinet?: Cabinet;
  logoClient?: string;
}

/** Un logo posé sur un cartouche clair, lisible sur le bleu de la charte. */
function cartoucheLogo(logo: string, classe = ''): string {
  if (!logo) return '';
  return `<div class="cartouche-logo${classe ? ` ${classe}` : ''}"><img src="${e(logo)}" alt=""></div>`;
}


interface OptionsLigne {
  classe?: string;
  detail?: boolean;
  /**
   * La part du chiffre d'affaires du dernier exercice, quand le tableau porte une
   * colonne de pourcentage. UNE valeur, pas une par exercice : l'ancienne version en
   * émettait n pour un en-tête qui n'en annonçait qu'une, et le tableau était décalé
   * quel que soit le nombre d'exercices.
   */
  part?: number | null;
  vide?: boolean;
}

/** Une ligne, dans la forme structurée que le composant de tableau attend. */
function ligne(libelle: string, valeurs: readonly number[], options: OptionsLigne = {}): LignePdf {
  const degre =
    options.classe === 'total'
      ? 'total'
      : options.classe === 'sous-total'
        ? 'sous-total'
        : options.classe === 'resultat'
          ? 'resultat'
          : options.detail
            ? 'detail'
            : 'normale';
  return { libelle, valeurs, degre, part: options.part, vide: options.vide };
}

/** Une cellule de montant isolée, pour un tableau composé à la main. */
function montant(valeur: number, options: { vide?: boolean } = {}): string {
  return celluleMontant(valeur, options);
}

/**
 * Une ligne dont les cellules ne sont pas des montants : un taux, une durée, un ratio.
 *
 * Les valeurs brutes restent fournies : elles portent le signe — donc la couleur d'un
 * négatif — et donnent au calcul de largeur de quoi mesurer.
 */
function ligneTexte(
  libelle: string,
  valeurs: readonly number[],
  textes: readonly string[],
  options: OptionsLigne = {},
): LignePdf {
  return { ...ligne(libelle, valeurs, options), textes };
}

/**
 * Un intitulé de ligne fondu dans une phrase : « Remboursements de TVA » y devient
 * « remboursements de TVA ».
 *
 * Seule l'initiale change, et pas si le premier mot est un sigle : « TVA » resterait
 * « TVA », là où une mise en minuscules générale rendait « remboursements de tva ».
 */
function enMinusculeInitiale(libelle: string): string {
  const premierMot = libelle.split(' ')[0] ?? '';
  if (premierMot === premierMot.toLocaleUpperCase('fr-FR')) return libelle;
  return libelle.charAt(0).toLocaleLowerCase('fr-FR') + libelle.slice(1);
}

/** Une ligne de groupe : un intitulé de rubrique, sans valeur. */
function groupe(libelle: string): LignePdf {
  return { libelle, valeurs: [], degre: 'groupe' };
}

/**
 * Un tableau. Les colonnes se répartissent sur la largeur utile, et se découpent en
 * blocs nommés si elles ne tiennent pas — c'est ce qui fait tenir un dossier à dix
 * exercices ou une annexe mensuelle de vingt-quatre mois.
 */
function tableau(
  entetes: readonly string[],
  lignes: readonly LignePdf[],
  options: {
    entetePart?: string;
    nomsColonnes?: readonly string[];
    plafondParBloc?: number;
    note?: string;
  } = {},
): string {
  return tableauComposant({ entetes, lignes, ...options });
}

/** Un tableau à colonnes fixes, dont les lignes sont déjà rendues. */
function tableauBrut(
  entetes: readonly string[],
  corps: string,
  options: { classe?: 'compacte' | 'dense'; note?: string } = {},
): string {
  return tableauBrutComposant({ entetes, corps, ...options });
}

/** Construit le document HTML complet du dossier prévisionnel. */
export function construireHtml(
  dossier: Dossier,
  r: Resultats,
  options: OptionsDocument = {},
): string {
  const cabinet = options.cabinet ?? CABINET_PAR_DEFAUT;
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

  const sections: Array<{ titre: string; court?: string; chapeau?: string; contenu: string }> = [];
  /**
   * N'empile qu'une section non vide : c'est ce qui fait disparaître d'elle-même la page
   * des emprunts d'un dossier sans emprunt, ou l'annexe de TVA d'un non-assujetti.
   */
  const ajouter = (
    titre: string,
    contenu: string,
    options: { court?: string; chapeau?: string } = {},
  ) => {
    if (contenu.trim()) sections.push({ titre, contenu, ...options });
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
      ? tableauBrut(
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

  // ─── Synthèse ───────────────────────────────────────────────────────────────
  /*
   * Une page de chiffres clés, placée avant le détail : le lecteur pressé n'ouvre
   * souvent que celle-là. Elle ne calcule rien — chaque valeur est reprise telle quelle
   * du moteur, et se retrouve à l'identique dans la section qui la détaille.
   */
  {
    const dernier = n - 1;
    const cr = r.compteResultat[dernier];
    const sig = r.sig[dernier];
    const caf = r.caf[dernier];
    const seuil = r.seuilRentabilite[dernier];
    const bfrFinal = r.bfr[dernier];
    const ca = cr?.chiffreAffaires ?? 0;
    const precedent = r.compteResultat[dernier - 1]?.chiffreAffaires ?? 0;

    /** « ▲ 5,0 % vs 2027 » — le triangle est tracé en SVG, U+25B2 n'est dans aucune police. */
    const variationCa = (): string | undefined => {
      if (n < 2 || !precedent) return undefined;
      const taux = ((ca - precedent) / precedent) * 100;
      if (taux === 0) return `stable par rapport à ${annees[dernier - 1] ?? ''}`;
      const hausse = taux > 0;
      return (
        triangleVariation(hausse ? 'hausse' : 'baisse', hausse ? COULEURS.positif : COULEURS.negatif) +
        `${pct(Math.abs(taux))} par rapport à ${e(annees[dernier - 1] ?? '')}`
      );
    };

    const moisLePlusBas = r.libellesMois[r.tresorerie.moisSoldeMinimum] ?? '';
    const tetes = cartouches([
      {
        intitule: `Chiffre d’affaires ${annees[dernier] ?? ''}`,
        valeur: eur(ca),
        precision: variationCa(),
        sens: n >= 2 && precedent && ca < precedent ? 'defavorable' : 'favorable',
      },
      {
        intitule: `Résultat net ${annees[dernier] ?? ''}`,
        valeur: eur(cr?.resultatNet ?? 0),
        precision: ca ? `${pct(((cr?.resultatNet ?? 0) / ca) * 100)} du chiffre d’affaires` : undefined,
        sens: (cr?.resultatNet ?? 0) < 0 ? 'defavorable' : 'neutre',
        saillant: true,
      },
      {
        intitule: 'Trésorerie la plus basse',
        valeur: eur(r.tresorerie.soldeMinimum),
        precision: moisLePlusBas || undefined,
        sens: r.tresorerie.soldeMinimum < 0 ? 'defavorable' : 'neutre',
      },
    ]);

    /*
     * Un indicateur qui n'a pas de sens ne s'affiche pas : le seuil de rentabilité d'un
     * exercice sans marge sur coût variable est infini, le point mort d'un chiffre
     * d'affaires nul l'est aussi. Les écrire « — » remplirait la page de tirets.
     */
    const lignesIndicateurs: Array<{ libelle: string; valeur: string; sens?: 'favorable' | 'defavorable' }> = [];
    if (sig) {
      lignesIndicateurs.push({ libelle: `Valeur ajoutée ${annees[dernier] ?? ''}`, valeur: eur(sig.valeurAjoutee) });
      lignesIndicateurs.push({
        libelle: 'Excédent brut d’exploitation',
        valeur: eur(sig.excedentBrutExploitation),
        sens: sig.excedentBrutExploitation < 0 ? 'defavorable' : undefined,
      });
    }
    if (caf) {
      lignesIndicateurs.push({
        libelle: 'Capacité d’autofinancement',
        valeur: eur(caf.caf),
        sens: caf.caf < 0 ? 'defavorable' : undefined,
      });
    }
    if (seuil && Number.isFinite(seuil.seuil) && seuil.seuil > 0) {
      lignesIndicateurs.push({
        libelle: `Seuil de rentabilité ${annees[dernier] ?? ''}`,
        valeur: eur(seuil.seuil),
      });
      if (Number.isFinite(seuil.pointMortJours) && seuil.pointMortJours > 0) {
        lignesIndicateurs.push({ libelle: 'Point mort', valeur: jours(seuil.pointMortJours) });
      }
    }
    if (bfrFinal) {
      lignesIndicateurs.push({
        libelle: 'Besoin en fonds de roulement',
        valeur: eur(bfrFinal.bfr),
        sens: bfrFinal.bfr > 0 ? 'defavorable' : 'favorable',
      });
      if (ca) {
        lignesIndicateurs.push({
          libelle: 'Soit, en jours de chiffre d’affaires',
          valeur: jours(bfrFinal.enJoursCA),
        });
      }
    }

    /*
     * 330 unités de large, et non les 640 par défaut.
     *
     * Le SVG conserve son rapport de forme : dans la colonne large de la grille, large
     * d'environ 88 mm, un dessin de 640 unités serait ramené à 59 % et ses libellés d'axe
     * avec lui — 10 points tomberaient à 6. En calant la largeur du dessin sur celle de la
     * colonne, l'échelle reste de un pour un et les chiffres de l'axe restent lisibles.
     * L'histogramme porte déjà sa propre légende : ne pas en ajouter une seconde.
     */
    const graphique = carte({
      intitule: 'Chiffre d’affaires et résultat net',
      contenu: histogramme(
        annees,
        [
          { libelle: 'Chiffre d’affaires', valeurs: r.recettes.caParExercice, couleur: COULEURS.marqueClaire },
          { libelle: 'Résultat net', valeurs: r.compteResultat.map((x) => x.resultatNet), couleur: COULEURS.or },
        ],
        { largeur: 330, hauteur: 250 },
      ),
    });
    const tableauIndicateurs = lignesIndicateurs.length
      ? carte({ intitule: 'Indicateurs', contenu: indicateurs(lignesIndicateurs), teintee: true })
      : '';

    ajouter(
      'La synthèse du prévisionnel',
      tetes +
        (tableauIndicateurs
          ? grille({ gauche: graphique, droite: tableauIndicateurs, proportion: 'large-etroit' })
          : graphique),
      {
        court: 'Synthèse',
        chapeau:
          'Les chiffres clés du dossier. Chacun est repris tel quel des sections qui suivent, ' +
          'où il est détaillé exercice par exercice.',
      },
    );
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
    // Le total ne porte que sur le montant : les trois colonnes suivantes — durée, mode,
    // mise en service — n'ont pas de somme, et une cellule vide le dit mieux qu'un zéro.
    corps += `<tr class="total"><td>Total des investissements</td>${montant(
      investissements.reduce((t, l) => t + l.montantHT, 0),
    )}<td colspan="3"></td></tr>`;

    const cessions = dossier.investissements.cessions.filter((c) => c.actif && c.prixCessionHT > 0);
    const tableCessions = cessions.length
      ? `<h3 class="sous-titre">Les cessions d’immobilisations prévues :</h3>` +
        tableauBrut(
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
        tableauBrut(['Désignation', 'Montant HT', 'Amortissement', 'Exercice', 'Acquisition'], corps) +
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
        corps += `<tr><td class="detail">${e(x.libelle)}${x.organisme ? ` — ${e(x.organisme)}` : ''} (${pct(x.tauxAnnuel, 2)} sur ${x.dureeMois} mois)</td>${montant(x.montant)}<td>${e(annees[x.exerciceDeblocage] ?? '')}</td></tr>`;
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
           <p>Besoins du premier exercice : <strong>${eur(plan.besoins.total)}</strong> —
              Ressources mobilisées : <strong>${eur(plan.ressources.total)}</strong>.
              ${
                ecart < 0
                  ? `Il manque <strong>${eur(-ecart)}</strong> pour équilibrer le plan de financement.`
                  : `Le plan de financement dégage une marge de <strong>${eur(ecart)}</strong>.`
              }</p>
         </div>`
      : '';

    const tableCb = creditsBaux.length
      ? `<h3 class="sous-titre">Les contrats de crédit-bail :</h3>` +
        tableauBrut(
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
        tableauBrut(['Nature', 'Montant', 'Exercice'], corps) +
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
          `<h3 class="sous-titre">${e(t.libelle)} — ${eur(t.montant)} sur ${t.dureeMois} mois au taux de ${pct(t.tauxAnnuel, 2)}</h3>` +
          `<p>Mensualité hors assurance : <strong>${eur(t.mensualite, 2)}</strong>. Coût total du crédit sur la période : <strong>${eur(cout)}</strong>.</p>` +
          tableauBrut(
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
    const corps: LignePdf[] = [
      ...r.recettes.detail.map((d) => ligne(d.libelle, d.montants, { detail: true })),
      ligne('Total du chiffre d’affaires', r.recettes.caParExercice, { classe: 'total' }),
    ];

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
        (r.recettes.detail.length > 1
          ? `<h3 class="sous-titre">Le poids de chaque activité en ${e(annees[n - 1] ?? '')} :</h3>` +
            jauges({
              postes: r.recettes.detail.map((d) => ({
                libelle: d.libelle,
                valeur: d.montants[n - 1] ?? 0,
              })),
            })
          : ''),
    );
  }

  // ─── Personnel ──────────────────────────────────────────────────────────────
  const personnel = r.charges.personnel.filter((p) => p.brut.some((v) => v !== 0));
  if (personnel.length) {
    const corps: LignePdf[] = [];
    for (const p of personnel) {
      corps.push(
        ligne(
          `${p.libelle} — ${LIBELLES_STATUT_PERSONNEL[p.statut as keyof typeof LIBELLES_STATUT_PERSONNEL] ?? p.statut}`,
          p.brut,
          { detail: true },
        ),
      );
      if (p.charges.some((v) => v !== 0)) {
        corps.push(ligne('dont charges sociales', p.charges, { detail: true }));
      }
    }
    const totalBrut = sommeParExercice(personnel.map((p) => (p.nonDeductible ? p.brut.map(() => 0) : p.brut)), n);
    const totalCharges = sommeParExercice(personnel.map((p) => p.charges), n);
    corps.push(
      ligne('Total de la masse salariale chargée', totalBrut.map((v, i) => v + totalCharges[i]), {
        classe: 'total',
      }),
    );

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
    const corps: LignePdf[] = [];
    for (const [categorie, lignes] of groupes) {
      corps.push(
        groupe(
          LIBELLES_CATEGORIE_CHARGE[categorie as keyof typeof LIBELLES_CATEGORIE_CHARGE] ??
            categorie,
        ),
      );
      for (const d of lignes) corps.push(ligne(d.libelle, d.montants, { detail: true }));
      // Le sous-total par rubrique est conservé : sans lui, le total cesse d'être la
      // somme visible des groupes, et le lecteur ne peut plus le recomposer.
      corps.push(
        ligne('Sous-total', sommeParExercice(lignes.map((l) => l.montants), n), {
          classe: 'sous-total',
        }),
      );
    }
    corps.push(ligne('Total des charges externes', r.charges.totalParExercice, { classe: 'total' }));

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
        // Les mêmes jauges que la ventilation du chiffre d'affaires : deux dessins
        // différents pour la même idée de répartition auraient été deux idées.
        jauges({ postes: repartition }),
    );
  }

  // ─── Dotations aux amortissements ───────────────────────────────────────────
  const plans = r.amortissements.filter((p) => p.dotations.some((d) => d !== 0));
  if (plans.length) {
    const corps: LignePdf[] = [
      ...plans.map((p) => ligne(`${p.libelle} (${p.dureeAnnees} ans)`, p.dotations, { detail: true })),
      ligne('Total des dotations', r.compteResultat.map((c) => c.dotationsAmortissements), {
        classe: 'total',
      }),
      ligne('Valeur nette comptable à la clôture', sommeParExercice(plans.map((p) => p.vnc), n), {
        classe: 'sous-total',
      }),
    ];
    ajouter(
      'Les dotations aux amortissements',
      `<h3 class="sous-titre">Les dotations par immobilisation :</h3>` +
        tableau(['Immobilisation', ...annees], corps),
    );
  }

  // ─── Compte de résultat ─────────────────────────────────────────────────────
  {
    const c = r.compteResultat;
    /**
     * La part du chiffre d'affaires du DERNIER exercice.
     *
     * Une seule colonne de pourcentage, donc une seule valeur. L'ancienne version en
     * produisait une par exercice pour un en-tête qui n'en annonçait qu'une : le tableau
     * était décalé, quel que soit le nombre d'exercices.
     */
    const caReference = c[n - 1]?.chiffreAffaires ?? 0;
    const partDuCa = (valeur: number): number | null =>
      caReference ? (valeur / caReference) * 100 : null;
    const l = (libelle: string, extraire: (x: (typeof c)[number]) => number, classe?: string) =>
      ligne(libelle, c.map(extraire), { classe, detail: !classe });

    const corps = [
      groupe('Produits d’exploitation'),
      l('Ventes de marchandises', (x) => x.ventesMarchandises),
      l('Production vendue', (x) => x.production),
      l('Subventions d’exploitation', (x) => x.subventionsExploitation),
      l('Autres produits', (x) => x.autresProduits),
      l('Total des produits d’exploitation', (x) => x.totalProduitsExploitation, 'sous-total'),
      groupe('Charges d’exploitation'),
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
        part: partDuCa(c[n - 1]?.resultatExploitation ?? 0),
      }),
      l('Charges financières', (x) => x.chargesFinancieres),
      ligne('RÉSULTAT COURANT AVANT IMPÔT', c.map((x) => x.resultatCourant), { classe: 'sous-total' }),
      l('Produits exceptionnels', (x) => x.produitsExceptionnels),
      l('Charges exceptionnelles', (x) => x.chargesExceptionnelles),
      /*
       * L'impôt sur les sociétés se déduit du résultat, l'impôt sur le revenu non : le
       * moteur ne retranche que le premier (`resultatNet = resultatAvantImpot -
       * impotSocietes`). Écrit au-dessus du résultat net comme l'IS, l'IR estimé se
       * lirait comme une charge de l'entreprise et le résultat paraîtrait net d'impôt.
       * Il figure donc sous la ligne de résultat, et la note du tableau le dit.
       */
      ...(societe ? [l('Impôt sur les sociétés', (x) => x.impotSocietes)] : []),
      ligne('RÉSULTAT NET', c.map((x) => x.resultatNet), {
        classe: 'resultat',
        part: partDuCa(c[n - 1]?.resultatNet ?? 0),
      }),
      ...(societe || c.every((x) => x.impotRevenuEstime === 0)
        ? []
        : [l('Impôt sur le revenu estimé, à la charge de l’exploitant', (x) => x.impotRevenuEstime)]),
    ];

    const noteImpot = societe
      ? ''
      : ' L’impôt sur le revenu est personnel à l’exploitant : il n’est pas une charge de' +
        ' l’entreprise et n’est donc pas retranché du résultat net. Il est estimé ici au taux' +
        ' moyen d’imposition retenu dans les paramètres du dossier.';

    ajouter(
      'Le compte de résultat prévisionnel',
      tableau(['Poste', ...annees], corps, {
        entetePart: `% du CA ${annees[n - 1] ?? ''}`,
        note:
          `Montants exprimés en euros. Les pourcentages sont rapportés au chiffre d’affaires de l’exercice ${annees[n - 1] ?? ''}.` +
          noteImpot,
      }),
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
    ];

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
    ];

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
        const textes = ratio.valeurs.map((v) =>
          ratio.unite === '%'
            ? pct(v)
            : ratio.unite === 'jours'
              ? jours(v)
              : ratio.unite === 'x'
                ? nombre(v, 2)
                : mont(v),
        );
        return ligneTexte(ratio.libelle, ratio.valeurs, textes, { detail: true });
      });

    const s = r.seuilRentabilite;
    const corpsSeuil = [
      ligne('Chiffre d’affaires', s.map((x) => x.chiffreAffaires), { detail: true }),
      ligne('Charges variables', s.map((x) => x.chargesVariables), { detail: true }),
      ligne('Marge sur coût variable', s.map((x) => x.margeSurCoutVariable), { classe: 'sous-total' }),
      ligneTexte(
        'Taux de marge sur coût variable',
        s.map((x) => x.tauxMargeSurCoutVariable),
        s.map((x) => pct(x.tauxMargeSurCoutVariable)),
        { detail: true },
      ),
      ligne('Charges fixes', s.map((x) => x.chargesFixes), { detail: true }),
      ligne('SEUIL DE RENTABILITÉ', s.map((x) => x.seuil), { classe: 'total' }),
      ligne('Seuil de rentabilité financier', s.map((x) => x.seuilFinancier), { classe: 'sous-total' }),
      ligneTexte(
        'Point mort',
        s.map((x) => x.pointMortJours),
        s.map((x) => jours(x.pointMortJours)),
        { detail: true },
      ),
      ligne('Marge de sécurité', s.map((x) => x.margeSecurite), { detail: true }),
    ];

    ajouter(
      'Les ratios et le seuil de rentabilité',
      `<h3 class="sous-titre">Les ratios d’exploitation et de structure :</h3>` +
        tableau(['Ratio', ...annees], corps) +
        `<h3 class="sous-titre">Le seuil de rentabilité :</h3>` +
        tableau(['Élément', ...annees], corpsSeuil) +
        histogramme(annees, [
          { libelle: 'Chiffre d’affaires', valeurs: s.map((x) => x.chiffreAffaires), couleur: COULEURS.marqueClaire },
          { libelle: 'Seuil de rentabilité', valeurs: s.map((x) => x.seuil), couleur: COULEURS.or },
        ]),
    );
  }

  // ─── BFR et plan de financement ─────────────────────────────────────────────
  {
    const b = r.bfr;
    const corps = [
      groupe('Besoins d’exploitation'),
      ligne('Stocks', b.map((x) => x.stocks), { detail: true }),
      ligne('Créances clients', b.map((x) => x.creancesClients), { detail: true }),
      ligne('Crédit de TVA', b.map((x) => x.creditTva), { detail: true }),
      ligne('Autres créances', b.map((x) => x.autresCreances), { detail: true }),
      ligne('Total des besoins', b.map((x) => x.totalBesoins), { classe: 'sous-total' }),
      groupe('Ressources d’exploitation'),
      ligne('Dettes fournisseurs', b.map((x) => x.dettesFournisseurs), { detail: true }),
      ligne('TVA à décaisser', b.map((x) => x.tvaADecaisser), { detail: true }),
      ligne('Dettes sociales', b.map((x) => x.dettesSociales), { detail: true }),
      ligne('Dettes fiscales', b.map((x) => x.dettesFiscales), { detail: true }),
      ligne('Autres dettes', b.map((x) => x.autresDettes), { detail: true }),
      ligne('Total des ressources', b.map((x) => x.totalRessources), { classe: 'sous-total' }),
      ligne('BESOIN EN FONDS DE ROULEMENT', b.map((x) => x.bfr), { classe: 'total' }),
      ligne('Variation de l’exercice', b.map((x) => x.variation), { detail: true }),
      ligneTexte(
        'Exprimé en jours de chiffre d’affaires',
        b.map((x) => x.enJoursCA),
        b.map((x) => jours(x.enJoursCA)),
        { detail: true },
      ),
    ];

    const pf = r.planFinancement;
    const corpsPf = [
      groupe('Besoins'),
      ligne('Investissements', pf.map((x) => x.besoins.investissements), { detail: true }),
      ligne('Remboursements d’emprunts', pf.map((x) => x.besoins.remboursementsEmprunts), { detail: true }),
      ligne('Remboursements de comptes courants', pf.map((x) => x.besoins.remboursementsComptesCourants), { detail: true }),
      ligne('Variation du besoin en fonds de roulement', pf.map((x) => x.besoins.variationBfr), { detail: true }),
      ligne('Distributions et prélèvements', pf.map((x) => x.besoins.distributions), { detail: true }),
      ligne('Total des besoins', pf.map((x) => x.besoins.total), { classe: 'sous-total' }),
      groupe('Ressources'),
      ligne('Capacité d’autofinancement', pf.map((x) => x.ressources.caf), { detail: true }),
      ligne('Apports et comptes courants', pf.map((x) => x.ressources.apports), { detail: true }),
      ligne('Emprunts', pf.map((x) => x.ressources.emprunts), { detail: true }),
      ligne('Subventions', pf.map((x) => x.ressources.subventions), { detail: true }),
      ligne('Cessions d’immobilisations', pf.map((x) => x.ressources.cessions), { detail: true }),
      ligne('Total des ressources', pf.map((x) => x.ressources.total), { classe: 'sous-total' }),
      ligne('SOLDE DE L’EXERCICE', pf.map((x) => x.solde), { classe: 'total' }),
      ligne('Solde cumulé', pf.map((x) => x.soldeCumule), { classe: 'sous-total' }),
    ];

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
      groupe('ACTIF'),
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
      groupe('PASSIF'),
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
    ];

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
        /*
         * Un solde ne s'additionne pas : le cumul de douze soldes de fin de mois ne veut
         * rien dire. La colonne « Total » de ces deux lignes reste donc vide — un chiffre
         * y serait faux, et un zéro le serait tout autant.
         */
        const solde = (libelle: string, extraire: (m: (typeof mois)[number]) => number, classe: string) => {
          const valeurs = mois.map(extraire);
          return ligneTexte(libelle, [...valeurs, 0], [...valeurs.map((v) => mont(v)), ''], { classe });
        };
        /*
         * Un poste sans un seul mouvement sur l'exercice ne prend pas de ligne, et la note
         * du tableau nomme ceux qui ont été retirés — c'est la règle de la maquette.
         *
         * Vingt lignes multipliées par les blocs de six mois d'un exercice, cela fait
         * jusqu'à quatre-vingts lignes de tirets pour un dossier qui n'a ni emprunt ni
         * personnel. Rien n'est caché : ce qui n'est pas écrit est nul, et la note le dit.
         * Les soldes et les totaux restent, même à zéro : ce sont eux qui se lisent.
         */
        const masques: string[] = [];
        const flux = (
          libelle: string,
          extraire: (m: (typeof mois)[number]) => number,
        ): LignePdf | null => {
          if (mois.every((m) => extraire(m) === 0)) {
            masques.push(libelle);
            return null;
          }
          return l(libelle, extraire);
        };
        const corps = [
          solde('Solde initial', (m) => m.soldeInitial, 'sous-total'),
          groupe('Encaissements'),
          flux('Ventes encaissées', (m) => m.encaissements.ventes),
          flux('Apports', (m) => m.encaissements.apports),
          flux('Emprunts', (m) => m.encaissements.emprunts),
          flux('Subventions', (m) => m.encaissements.subventions),
          flux('Cessions', (m) => m.encaissements.cessions),
          flux('Remboursements de TVA', (m) => m.encaissements.tvaRemboursee),
          flux('Autres encaissements', (m) => m.encaissements.autres),
          l('Total des encaissements', (m) => m.encaissements.total, 'sous-total'),
          groupe('Décaissements'),
          flux('Achats et charges', (m) => m.decaissements.achatsEtCharges),
          flux('Rémunérations', (m) => m.decaissements.salaires),
          flux('Charges sociales', (m) => m.decaissements.chargesSociales),
          flux('Investissements', (m) => m.decaissements.investissements),
          flux('Échéances d’emprunts', (m) => m.decaissements.echeancesEmprunts),
          flux('TVA', (m) => m.decaissements.tva),
          flux('Impôts et taxes', (m) => m.decaissements.impots),
          flux('Distributions', (m) => m.decaissements.distributions),
          flux('Autres décaissements', (m) => m.decaissements.autres),
          l('Total des décaissements', (m) => m.decaissements.total, 'sous-total'),
          solde('SOLDE FINAL', (m) => m.soldeFinal, 'total'),
        ].filter((ligne): ligne is LignePdf => ligne !== null);

        return `<h3 class="sous-titre">Exercice ${e(x.libelle)}</h3>` + tableau(entetes, corps, {
          // Six mois par bloc : c'est le rythme de la maquette, et il tient quel que
          // soit le nombre de mois de l'exercice — de un à vingt-quatre.
          plafondParBloc: 6,
          nomsColonnes: entetes.slice(1),
          note: masques.length
            ? `Les postes sans mouvement sur cet exercice ne sont pas repris : ${masques
                .map(enMinusculeInitiale)
                .join(', ')}.`
            : undefined,
        });
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
      tableauBrut(
        ['Période', 'TVA collectée', 'Déductible biens et services', 'Déductible immobilisations', 'Solde', 'Crédit reporté', 'À décaisser'],
        corps +
          `<tr class="total"><td>Total de la période</td>${montant(totaux.collectee)}${montant(totaux.bs)}${montant(totaux.immo)}${montant(totaux.solde)}<td>—</td>${montant(totaux.decaisser)}</tr>`,
        { classe: 'compacte' },
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
  const sommaire = sommaireComposant(sections.map((x) => x.titre));
  const corpsSections = sections
    .map(
      (s, i) =>
        `<section${i === 0 ? '' : ' class="nouvelle-page"'}>` +
        titreSection({ numero: i + 1, court: s.court, titre: s.titre, chapeau: s.chapeau }) +
        `${s.contenu}</section>`,
    )
    .join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(raison)} — Dossier prévisionnel</title><style>${STYLE}</style></head><body>
<div class="couverture">
  <div class="filet"></div>
  <div class="corps">
    <div class="entete">
      ${
        cabinet.logo
          ? cartoucheLogo(cabinet.logo, 'logo-cabinet')
          : `<div class="mot-compose">${e(cabinet.nom)}</div>`
      }
      <div class="mention-droite">
        <div>Dossier prévisionnel</div>
        <div>${e(intituleExercices(annees))}</div>
      </div>
    </div>
    <div class="client">
      <div class="etiquette">Établi pour</div>
      ${cartoucheLogo(options.logoClient ?? '')}
      <h1 class="${raison.length > 40 ? 'tres-long' : raison.length > 24 ? 'long' : ''}">${e(raison)}</h1>
      <div class="identite">
        <div>
          ${identite.formeJuridique ? `<p>${e(identite.formeJuridique)}</p>` : ''}
          ${identite.adresse.voie ? `<p>${e(identite.adresse.voie)}</p>` : ''}
          ${identite.adresse.codePostal || identite.adresse.ville ? `<p>${e(identite.adresse.codePostal)} ${e(identite.adresse.ville)}</p>` : ''}
        </div>
        ${
          identite.activite || identite.dirigeants.length
            ? `<div>
          ${identite.activite ? `<p>${e(identite.activite)}</p>` : ''}
          ${identite.dirigeants.map((d) => `<p>${e(d.nom)} — ${e(d.fonction)}</p>`).join('')}
        </div>`
            : ''
        }
      </div>
    </div>
  </div>
  <div class="pied">
    <div>
      <div class="etiquette">Établi par</div>
      <p>${e(cabinet.nom)}${cabinet.qualite ? ` — ${e(cabinet.qualite)}` : ''}</p>
      ${cabinet.expertComptable || cabinet.adresse.voie ? `<p>${[cabinet.expertComptable, adresseSurUneLigne(cabinet)].filter(Boolean).map((x) => e(x)).join(' · ')}</p>` : ''}
      ${cabinet.telephone || cabinet.courriel ? `<p>${[cabinet.telephone, cabinet.courriel].filter(Boolean).map((x) => e(x)).join(' · ')}</p>` : ''}
    </div>
    <div class="periode">${e(periode)}</div>
  </div>
</div>

<section>
  ${titreSection({ titre: 'Sommaire' })}
  ${sommaire}
  ${vigilance}
</section>

${corpsSections}

<div class="coordonnees">
  ${cartoucheLogo(cabinet.logo)}
  <div class="nom">${e(cabinet.nom)}</div>
  ${cabinet.qualite ? `<div class="qualite">${e(cabinet.qualite)}</div>` : ''}
  ${cabinet.adresse.voie ? `<p>${e(cabinet.adresse.voie)}</p>` : ''}
  ${cabinet.adresse.complement ? `<p>${e(cabinet.adresse.complement)}</p>` : ''}
  ${cabinet.adresse.codePostal || cabinet.adresse.ville ? `<p>${e(cabinet.adresse.codePostal)} ${e(cabinet.adresse.ville)}</p>` : ''}
  ${cabinet.telephone ? `<p>${e(cabinet.telephone)}</p>` : ''}
  ${cabinet.courriel ? `<p>${e(cabinet.courriel)}</p>` : ''}
  ${cabinet.site ? `<p>${e(cabinet.site)}</p>` : ''}
  ${mentionsLegales(cabinet)}
  ${cabinet.mentionLegale ? `<div class="mention">${e(cabinet.mentionLegale)}</div>` : ''}
</div>
</body></html>`;
}

/** « Exercices 2026 à 2028 », ou « Exercice 2026 » quand le dossier n'en compte qu'un. */
function intituleExercices(annees: readonly string[]): string {
  if (!annees.length) return '';
  if (annees.length === 1) return `Exercice ${annees[0]}`;
  return `Exercices ${annees[0]} à ${annees[annees.length - 1]}`;
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
    .map((a, i) => (i === 0 ? null : `${a} ${pct(croissance[i])}`))
    .filter(Boolean)
    .join(', ')}.</p>`;
}

/**
 * Mentions professionnelles du cabinet : forme juridique, capital, immatriculation,
 * et inscription au tableau de l'Ordre — obligatoire sur un document d'expertise comptable.
 */
function mentionsLegales(cabinet: Cabinet): string {
  const lignes = [
    [cabinet.formeJuridique, cabinet.capital && `au capital de ${cabinet.capital}`]
      .filter(Boolean)
      .join(' '),
    cabinet.siret && `SIRET ${cabinet.siret}`,
    cabinet.numeroTva && `TVA ${cabinet.numeroTva}`,
    cabinet.inscriptionOrdre,
  ].filter(Boolean) as string[];
  if (!lignes.length) return '';
  return `<div class="legales">${lignes.map((l) => e(l)).join('<br>')}</div>`;
}

/**
 * Gabarit de pied de page : le seul bandeau répété du document.
 *
 * Deux raisons de le confier au gabarit natif de Chromium plutôt qu'à la feuille de style :
 * lui seul connaît le nombre total de pages, et lui seul est placé de façon fiable dans la
 * marge basse d'une page paginée. Il est en revanche dessiné sur toutes les pages, y compris
 * celles à marge nulle : la couverture et les coordonnées leur réservent donc 16 mm
 * (« --bande-pied », style.ts), sans quoi son filet traverserait leur aplat.
 *
 * Autre contrepartie, il est rendu dans un document isolé : ni la feuille de style du dossier,
 * ni son ajustement des couleurs ne s'y appliquent. Tout est donc en ligne, y compris les
 * deux @font-face, sans quoi ce pied serait la seule ligne du document composée dans la
 * police du système.
 *
 * L'en-tête, lui, n'existe plus : la raison sociale et la période sont dans la colonne de
 * gauche, et un second bandeau à chaque page alourdissait la page sans rien apprendre.
 */
export function construirePied(
  dossier: Dossier,
  r: Resultats,
  cabinet = CABINET_PAR_DEFAUT,
): string {
  const periode = formaterPeriode(
    r.exercices[0]?.dateDebut ?? '',
    r.exercices[r.exercices.length - 1]?.dateFin ?? '',
  );
  const gauche = [dossier.identite.raisonSociale || 'Dossier prévisionnel', periode]
    .filter(Boolean)
    .join(' · ');
  const milieu = [cabinet.nom, adresseSurUneLigne(cabinet)].filter(Boolean).join(' — ');

  // 18 mm de retrait : l'alignement du pied sur la justification du corps (@page, style.ts).
  return `<style>${REGLES_POLICES_PIED}</style>
  <div style="width:100%;padding:0 18mm;box-sizing:border-box;
              -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6mm;
                border-top:0.4pt solid #ddd8e3;padding-top:2.6mm;
                font-family:'Hanken Grotesk',sans-serif;font-size:6.6pt;line-height:1.2;
                color:#8c8497;letter-spacing:0.04em;">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e(gauche)}</span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e(milieu)}</span>
      <span style="font-family:'IBM Plex Mono',monospace;font-weight:500;white-space:nowrap;
                   color:#6b6276;letter-spacing:0;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  </div>`;
}

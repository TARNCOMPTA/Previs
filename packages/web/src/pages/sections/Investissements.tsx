import { useCallback, useMemo } from 'react';
import {
  formaterEuros,
  LIBELLES_CATEGORIE_INVESTISSEMENT,
  type Cession,
  type LigneInvestissement,
} from '@previs/core';
import { ChampMontant, ChampNombre, ChampTaux, ChampTexte, Interrupteur, Selecteur } from '../../ui/champs.js';
import { CarteIndicateur, Bandeau } from '../../ui/divers.js';
import { GrilleLignes, type Colonne } from '../../ui/grille.js';
import { useDossier } from '../../store/dossier.js';
import { AvecDossier, BlocGrille, EnTeteSection, RangeeIndicateurs, type ContexteSection } from './commun.js';

const CATEGORIES = Object.entries(LIBELLES_CATEGORIE_INVESTISSEMENT).map(([valeur, libelle]) => ({
  valeur: valeur as LigneInvestissement['categorie'],
  libelle,
}));

const MODES = [
  { valeur: 'lineaire' as const, libelle: 'Linéaire' },
  { valeur: 'degressif' as const, libelle: 'Dégressif' },
  { valeur: 'aucun' as const, libelle: 'Non amortissable' },
];

/** Écran de saisie des investissements et des cessions d'immobilisations. */
/**
 * Le corps de l'écran, composant du module et non fonction écrite dans le JSX.
 *
 * C'est ce qui lui permet d'employer « useMemo » et « useCallback », donc de présenter
 * aux grilles des colonnes et des rappels stables : une frappe ne redessine alors que la
 * ligne modifiée. Sa référence doit rester celle du module.
 */
function CorpsInvestissements({ dossier, resultats, annees, modifierLigne, ajouterLigne, supprimerLigne, dupliquerLigne, deplacerLigne }: ContexteSection) {
  const lignes = dossier.investissements.lignes;
  /*
   * Stabilisé sur son CONTENU : « filter » rend un tableau neuf à chaque rendu, ce qui
   * invaliderait « colonnes » à chaque frappe et annulerait la mémoïsation des lignes. La
   * liste des emprunts, elle, ne change que si un emprunt est ajouté, retiré ou renommé.
   */
  const signatureEmprunts = dossier.financements.emprunts
    .filter((e) => e.actif)
    .map((e) => `${e.id}\u0001${e.libelle}`)
    .join('\u0002');
  const emprunts = useMemo(
    () => dossier.financements.emprunts.filter((e) => e.actif),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la signature porte le contenu
    [signatureEmprunts],
  );

  const totalInvesti = lignes
    .filter((l) => l.actif && l.categorie !== 'tresorerie_demarrage')
    .reduce((t, l) => t + l.montantHT, 0);
  const dotationsCumulees = resultats.compteResultat.reduce(
    (t, c) => t + c.dotationsAmortissements,
    0,
  );
  const financeParEmprunt = lignes
    .filter((l) => l.actif && l.financeParEmpruntId)
    .reduce((t, l) => t + l.montantHT, 0);

  /* Stables : ce sont elles que capturent les fonctions de rendu des colonnes mémoïsées. */
  const majuscule = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('investissements.lignes', id, champs),
    [modifierLigne],
  );
  const supprimerImmo = useCallback(
    (l: LigneInvestissement) => supprimerLigne('investissements.lignes', l.id),
    [supprimerLigne],
  );
  const dupliquerImmo = useCallback(
    (l: LigneInvestissement) => dupliquerLigne('investissements.lignes', l.id),
    [dupliquerLigne],
  );
  const deplacerImmo = useCallback(
    (l: LigneInvestissement, sens: -1 | 1) => deplacerLigne('investissements.lignes', l.id, sens),
    [deplacerLigne],
  );
  const immoProposee = useCallback((l: LigneInvestissement) => l.origine === 'llm', []);
  const detailImmo = useCallback(
    (l: LigneInvestissement) => (
        <div className="grille-champs">
          <ChampTaux
            libelle="Taux de TVA"
            valeur={l.tauxTva}
            onChange={(v) => majuscule(l.id, { tauxTva: v })}
          />
          <Interrupteur
            libelle="TVA récupérable"
            valeur={l.tvaRecuperable}
            onChange={(v) => majuscule(l.id, { tvaRecuperable: v })}
            aide="À décocher pour un véhicule de tourisme."
          />
          <ChampMontant
            libelle="Valeur résiduelle non amortie"
            valeur={l.valeurResiduelle}
            onChange={(v) => majuscule(l.id, { valeurResiduelle: v })}
            aide="Part non amortissable, un terrain par exemple."
          />
          <ChampNombre
            libelle="Échelonnement du règlement (mois)"
            valeur={l.echelonnementMois}
            min={1}
            max={36}
            onChange={(v) => majuscule(l.id, { echelonnementMois: v })}
          />
          <Selecteur
            libelle="Financé par l’emprunt"
            valeur={l.financeParEmpruntId ?? ''}
            onChange={(v) => majuscule(l.id, { financeParEmpruntId: v || undefined })}
            options={[
              { valeur: '', libelle: '— aucun —' },
              ...emprunts.map((e) => ({ valeur: e.id, libelle: e.libelle })),
            ]}
          />
          <ChampTexte
            libelle="Compte du plan comptable"
            valeur={l.compte ?? ''}
            onChange={(v) => majuscule(l.id, { compte: v || undefined })}
            placeholder="2183"
          />
          <ChampTexte
            libelle="Note"
            valeur={l.note ?? ''}
            onChange={(v) => majuscule(l.id, { note: v || undefined })}
          />
          <Interrupteur
            libelle="Ligne active"
            valeur={l.actif}
            onChange={(v) => majuscule(l.id, { actif: v })}
            aide="Une ligne désactivée reste visible mais sort de tous les calculs."
          />
        </div>
    ),
    [majuscule, annees, emprunts],
  );

  const colonnes = useMemo<Array<Colonne<LigneInvestissement>>>(() => [
    {
      cle: 'libelle',
      entete: 'Désignation',
      largeur: 210,
      alignementGauche: true,
      rendu: (l) => <ChampTexte valeur={l.libelle} onChange={(v) => majuscule(l.id, { libelle: v })} />,
    },
    {
      cle: 'categorie',
      entete: 'Catégorie',
      largeur: 190,
      alignementGauche: true,
      rendu: (l) => (
        <Selecteur
          valeur={l.categorie}
          onChange={(v) => majuscule(l.id, { categorie: v })}
          options={CATEGORIES}
        />
      ),
    },
    {
      cle: 'montant',
      entete: 'Montant HT',
      largeur: 110,
      rendu: (l) => <ChampMontant valeur={l.montantHT} onChange={(v) => majuscule(l.id, { montantHT: v })} />,
      total: (l) => (l.actif ? l.montantHT : 0),
    },
    {
      cle: 'exercice',
      entete: 'Exercice',
      largeur: 96,
      rendu: (l) => (
        <Selecteur
          valeur={String(l.exercice)}
          onChange={(v) => majuscule(l.id, { exercice: Number(v) })}
          options={annees.map((a, i) => ({ valeur: String(i), libelle: a }))}
        />
      ),
    },
    {
      cle: 'mois',
      entete: 'Mois',
      largeur: 68,
      aide: '1 correspond au premier mois de l’exercice.',
      rendu: (l) => (
        <ChampNombre valeur={l.mois} min={1} max={24} onChange={(v) => majuscule(l.id, { mois: v })} />
      ),
    },
    {
      cle: 'mode',
      entete: 'Amortissement',
      largeur: 140,
      alignementGauche: true,
      rendu: (l) => (
        <Selecteur
          valeur={l.modeAmortissement}
          onChange={(v) => majuscule(l.id, { modeAmortissement: v })}
          options={MODES}
        />
      ),
    },
    {
      cle: 'duree',
      entete: 'Durée',
      largeur: 74,
      aide: 'Durée d’amortissement en années.',
      rendu: (l) =>
        l.modeAmortissement === 'aucun' ? (
          <span className="discret">—</span>
        ) : (
          <ChampNombre
            valeur={l.dureeAmortissementAnnees}
            min={0}
            max={50}
            onChange={(v) => majuscule(l.id, { dureeAmortissementAnnees: v })}
          />
        ),
    },
    ...annees.map((annee, i) => ({
      cle: `dot${i}`,
      entete: `Dotation ${annee}`,
      largeur: 104,
      rendu: (l: LigneInvestissement) => <DotationDeLigne investissementId={l.id} exercice={i} />,
    })),
  ], [annees, majuscule, emprunts]);

  /*
   * Les dotations viennent du plan d'amortissement calculé par le moteur : recalculées à
   * chaque rendu, hors des colonnes mémoïsées, qui capteraient sinon un plan périmé.
   */
  const totauxDotations: Record<string, number> = {};
  annees.forEach((_, i) => {
    totauxDotations[`dot${i}`] = resultats.amortissements.reduce((t, p) => t + (p.dotations[i] ?? 0), 0);
  });

  const cessions = dossier.investissements.cessions;
  const colonnesCessions: Array<Colonne<Cession>> = [
    {
      cle: 'libelle',
      entete: 'Bien cédé',
      largeur: 210,
      alignementGauche: true,
      rendu: (c) => (
        <ChampTexte
          valeur={c.libelle}
          onChange={(v) => modifierLigne('investissements.cessions', c.id, { libelle: v })}
        />
      ),
    },
    {
      cle: 'immobilisation',
      entete: 'Immobilisation',
      largeur: 200,
      alignementGauche: true,
      rendu: (c) => (
        <Selecteur
          valeur={c.investissementId ?? ''}
          onChange={(v) =>
            modifierLigne('investissements.cessions', c.id, { investissementId: v || undefined })
          }
          options={[
            { valeur: '', libelle: '— hors plan d’investissement —' },
            ...lignes.map((l) => ({ valeur: l.id, libelle: l.libelle })),
          ]}
        />
      ),
    },
    {
      cle: 'exercice',
      entete: 'Exercice',
      largeur: 96,
      rendu: (c) => (
        <Selecteur
          valeur={String(c.exercice)}
          onChange={(v) => modifierLigne('investissements.cessions', c.id, { exercice: Number(v) })}
          options={annees.map((a, i) => ({ valeur: String(i), libelle: a }))}
        />
      ),
    },
    {
      cle: 'mois',
      entete: 'Mois',
      largeur: 68,
      rendu: (c) => (
        <ChampNombre
          valeur={c.mois}
          min={1}
          max={24}
          onChange={(v) => modifierLigne('investissements.cessions', c.id, { mois: v })}
        />
      ),
    },
    {
      cle: 'prix',
      entete: 'Prix de cession HT',
      largeur: 130,
      rendu: (c) => (
        <ChampMontant
          valeur={c.prixCessionHT}
          onChange={(v) => modifierLigne('investissements.cessions', c.id, { prixCessionHT: v })}
        />
      ),
      total: (c) => (c.actif ? c.prixCessionHT : 0),
    },
  ];

  return (
    <div className="pile">
      <EnTeteSection
        titre="Investissement"
        description="Les immobilisations acquises sur la période, leur mode d’amortissement et les cessions envisagées."
        synthese={
          <RangeeIndicateurs>
            <CarteIndicateur valeur={formaterEuros(totalInvesti)} libelle="Total investi sur la période" />
            <CarteIndicateur
              valeur={formaterEuros(dotationsCumulees)}
              libelle="Dotations aux amortissements cumulées"
            />
            <CarteIndicateur
              valeur={formaterEuros(financeParEmprunt)}
              libelle="Dont adossé à un emprunt"
              detail={emprunts.length === 0 ? 'Aucun emprunt saisi' : undefined}
            />
            <CarteIndicateur
              valeur={formaterEuros(resultats.bilans[resultats.bilans.length - 1]?.actif.immobilisationsNettes ?? 0)}
              libelle="Valeur nette comptable à la fin"
            />
          </RangeeIndicateurs>
        }
      />

      <BlocGrille
        titre="Les immobilisations"
        aide="Le stock de départ et la trésorerie de démarrage ne s’amortissent jamais : ils figurent au bilan, pas au compte de résultat."
      >
        <GrilleLignes
          colonnes={colonnes}
          lignes={lignes}
          cle={(l) => l.id}
          totauxFrais={totauxDotations}
          estProposee={immoProposee}
          onSupprimer={supprimerImmo}
          onDupliquer={dupliquerImmo}
          onDeplacer={deplacerImmo}
          messageVide="Aucun investissement saisi. Ajouter une immobilisation pour démarrer."
          libelleTotal="Total des investissements"
          detail={detailImmo}
          actions={
            <>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('investissements.lignes', {
                    libelle: 'Nouvelle immobilisation',
                    categorie: 'corporel',
                    tauxTva: dossier.parametres.tva.tauxParDefaut,
                    tvaRecuperable: dossier.parametres.tva.assujetti,
                    dureeAmortissementAnnees: 5,
                  })
                }
              >
                + Immobilisation
              </button>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('investissements.lignes', {
                    libelle: 'Stock de départ',
                    categorie: 'stock_initial',
                    modeAmortissement: 'aucun',
                    dureeAmortissementAnnees: 0,
                    tauxTva: dossier.parametres.tva.tauxParDefaut,
                  })
                }
              >
                + Stock de départ
              </button>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('investissements.lignes', {
                    libelle: 'Trésorerie de démarrage',
                    categorie: 'tresorerie_demarrage',
                    modeAmortissement: 'aucun',
                    dureeAmortissementAnnees: 0,
                    tauxTva: 0,
                  })
                }
              >
                + Trésorerie de démarrage
              </button>
            </>
          }
        />
      </BlocGrille>

      <BlocGrille
        titre="Les cessions d’immobilisations"
        aide="Le prix de cession est un produit exceptionnel, la valeur nette comptable une charge exceptionnelle : leur différence forme la plus ou moins-value."
      >
        <GrilleLignes
          colonnes={colonnesCessions}
          lignes={cessions}
          cle={(c) => c.id}
          estProposee={(c) => c.origine === 'llm'}
          onSupprimer={(c) => supprimerLigne('investissements.cessions', c.id)}
          messageVide="Aucune cession prévue."
          libelleTotal="Total des cessions"
          actions={
            <button
              className="bouton"
              onClick={() =>
                ajouterLigne('investissements.cessions', {
                  libelle: 'Cession',
                  tauxTva: dossier.parametres.tva.tauxParDefaut,
                  exercice: Math.max(0, annees.length - 1),
                  mois: 12,
                })
              }
            >
              + Cession
            </button>
          }
        />
      </BlocGrille>

      {dossier.investissements.lignes.some(
        (l) => l.actif && l.categorie === 'tresorerie_demarrage' && l.montantHT > 0,
      ) ? (
        <Bandeau>
          La trésorerie de démarrage n’est pas une dépense : elle reste disponible au bilan.
          Elle n’apparaît donc ni en décaissement, ni en besoin du plan de financement.
        </Bandeau>
      ) : null}
    </div>
  );
}

export default function Investissements() {
  return <AvecDossier corps={CorpsInvestissements} />;
}

/**
 * La dotation aux amortissements d'une immobilisation, lue directement du magasin.
 *
 * Elle vient du plan d'amortissement calculé par le moteur : une colonne mémoïsée en
 * capturerait une version périmée, et une dotation périmée est un chiffre faux.
 */
function DotationDeLigne({ investissementId, exercice }: { investissementId: string; exercice: number }) {
  const dotation = useDossier(
    (e) =>
      e.resultats?.amortissements.find((p) => p.investissementId === investissementId)?.dotations[exercice] ?? 0,
  );
  return <span className="discret nombres">{formaterEuros(dotation)}</span>;
}

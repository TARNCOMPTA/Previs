import { useCallback, useMemo } from 'react';
import {
  formaterEuros,
  LIBELLES_CATEGORIE_CHARGE,
  LIBELLES_STATUT_PERSONNEL,
  type LigneCharge,
  type LignePersonnel,
} from '@previs/core';
import { ChampMontant, ChampNombre, ChampTaux, ChampTexte, Interrupteur, Selecteur } from '../../ui/champs.js';
import { Bandeau, CarteIndicateur, RepartitionMensuelle } from '../../ui/divers.js';
import { GrilleLignes, type Colonne } from '../../ui/grille.js';
import { useDossier } from '../../store/dossier.js';
import { AvecDossier, BlocGrille, EnTeteSection, RangeeIndicateurs, type ContexteSection } from './commun.js';

const CATEGORIES = Object.entries(LIBELLES_CATEGORIE_CHARGE).map(([valeur, libelle]) => ({
  valeur: valeur as LigneCharge['categorie'],
  libelle,
}));

const STATUTS = Object.entries(LIBELLES_STATUT_PERSONNEL).map(([valeur, libelle]) => ({
  valeur: valeur as LignePersonnel['statut'],
  libelle,
}));

/** Écran de saisie des charges d'exploitation et du personnel. */
/**
 * Le corps de l'écran, composant du module et non fonction écrite dans le JSX.
 *
 * C'est ce qui lui permet d'employer « useMemo » et « useCallback », donc de présenter
 * aux grilles des colonnes et des rappels stables : une frappe ne redessine alors que la
 * ligne modifiée. Sa référence doit rester celle du module.
 */
function CorpsCharges({ dossier, resultats, annees, modifierLigne, ajouterLigne, supprimerLigne, dupliquerLigne, deplacerLigne }: ContexteSection) {
  const nbExercices = annees.length;
  /*
   * Stables : ce sont elles que capturent les fonctions de rendu des colonnes. Recréées à
   * chaque rendu, elles invalideraient « colonnesCharges », donc la mémoïsation des lignes.
   */
  const majCharge = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('charges.lignes', id, champs),
    [modifierLigne],
  );
  const majPersonnel = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('charges.personnel', id, champs),
    [modifierLigne],
  );
  const supprimerCharge = useCallback((l: LigneCharge) => supprimerLigne('charges.lignes', l.id), [supprimerLigne]);
  const dupliquerCharge = useCallback((l: LigneCharge) => dupliquerLigne('charges.lignes', l.id), [dupliquerLigne]);
  const deplacerCharge = useCallback(
    (l: LigneCharge, sens: -1 | 1) => deplacerLigne('charges.lignes', l.id, sens),
    [deplacerLigne],
  );
  const chargeProposee = useCallback((l: LigneCharge) => l.origine === 'llm', []);
  const personnelPropose = useCallback((p: LignePersonnel) => p.origine === 'llm', []);
  const supprimerPersonnel = useCallback(
    (p: LignePersonnel) => supprimerLigne('charges.personnel', p.id),
    [supprimerLigne],
  );
  const dupliquerPersonnel = useCallback(
    (p: LignePersonnel) => dupliquerLigne('charges.personnel', p.id),
    [dupliquerLigne],
  );
  const detailPersonnel = useCallback(
    (p: LignePersonnel) => (
        <div className="grille-champs">
          <Selecteur
            libelle="Exercice d’entrée"
            valeur={String(p.exerciceEmbauche)}
            onChange={(v) => majPersonnel(p.id, { exerciceEmbauche: Number(v) })}
            options={annees.map((x, i) => ({ valeur: String(i), libelle: x }))}
          />
          <ChampNombre
            libelle="Mois d’entrée"
            valeur={p.moisEmbauche}
            min={1}
            max={24}
            onChange={(v) => majPersonnel(p.id, { moisEmbauche: v })}
          />
          {annees.map((annee, i) => (
            <ChampNombre
              key={`mois${i}`}
              libelle={`Mois rémunérés ${annee}`}
              valeur={p.nbMoisParExercice[i] ?? 12}
              min={0}
              max={24}
              onChange={(v) => {
                const suivants = [...p.nbMoisParExercice];
                suivants[i] = v;
                majPersonnel(p.id, { nbMoisParExercice: suivants });
              }}
            />
          ))}
          {annees.map((annee, i) => (
            <ChampMontant
              key={`prime${i}`}
              libelle={`Primes ${annee}`}
              valeur={p.primes[i] ?? 0}
              onChange={(v) => {
                const suivants = [...p.primes];
                suivants[i] = v;
                majPersonnel(p.id, { primes: suivants });
              }}
            />
          ))}
          {annees.map((annee, i) => (
            <ChampMontant
              key={`aide${i}`}
              libelle={`Aides à l’embauche ${annee}`}
              valeur={p.aides[i] ?? 0}
              onChange={(v) => {
                const suivants = [...p.aides];
                suivants[i] = v;
                majPersonnel(p.id, { aides: suivants });
              }}
            />
          ))}
          {p.statut === 'salarie' || p.statut === 'dirigeant_assimile' ? (
            <ChampTaux
              libelle="Taux de charges patronales"
              valeur={p.tauxChargesPatronales ?? dossier.parametres.social.tauxChargesPatronales}
              onChange={(v) => majPersonnel(p.id, { tauxChargesPatronales: v })}
            />
          ) : (
            <ChampTaux
              libelle="Taux de cotisations TNS"
              valeur={p.tauxCotisationsTns ?? dossier.parametres.tns.tauxCotisations}
              onChange={(v) => majPersonnel(p.id, { tauxCotisationsTns: v })}
            />
          )}
          <Interrupteur libelle="Ligne active" valeur={p.actif} onChange={(v) => majPersonnel(p.id, { actif: v })} />
        </div>
    ),
    [majPersonnel, annees],
  );
  const detailCharge = useCallback(
    (l: LigneCharge) => (
        <div className="pile">
          <div className="grille-champs">
            <ChampTaux libelle="Taux de TVA" valeur={l.tauxTva} onChange={(v) => majCharge(l.id, { tauxTva: v })} />
            <Interrupteur
              libelle="TVA déductible"
              valeur={l.tvaDeductible}
              onChange={(v) => majCharge(l.id, { tvaDeductible: v })}
            />
            <ChampNombre
              libelle="Délai de règlement (jours)"
              valeur={l.delaiPaiementJours ?? dossier.parametres.bfr.delaiFournisseursJours}
              min={0}
              max={365}
              onChange={(v) => majCharge(l.id, { delaiPaiementJours: v })}
              aide="Laisser au délai général si le poste suit la règle commune."
            />
            <ChampTexte
              libelle="Compte du plan comptable"
              valeur={l.compte ?? ''}
              onChange={(v) => majCharge(l.id, { compte: v || undefined })}
              placeholder="613"
            />
            <ChampTexte
              libelle="Note"
              valeur={l.note ?? ''}
              onChange={(v) => majCharge(l.id, { note: v || undefined })}
            />
            <Interrupteur libelle="Ligne active" valeur={l.actif} onChange={(v) => majCharge(l.id, { actif: v })} />
          </div>
          <RepartitionMensuelle
            valeur={l.repartition}
            onChange={(v) => majCharge(l.id, { repartition: v })}
            nbExercices={nbExercices}
          />
        </div>
    ),
    [majCharge],
  );

  const dernier = nbExercices - 1;
  const masseSalariale = resultats.compteResultat.map((c) => c.salairesBruts + c.chargesSociales);
  const aUnExploitant = dossier.charges.personnel.some((p) => p.actif && p.statut === 'exploitant');

  const colonnesCharges: Array<Colonne<LigneCharge>> = useMemo(() => [
    {
      cle: 'libelle',
      entete: 'Poste de charge',
      largeur: 180,
      alignementGauche: true,
      rendu: (l) => <ChampTexte valeur={l.libelle} onChange={(v) => majCharge(l.id, { libelle: v })} />,
    },
    {
      cle: 'categorie',
      entete: 'Catégorie',
      largeur: 180,
      alignementGauche: true,
      rendu: (l) => (
        <Selecteur valeur={l.categorie} onChange={(v) => majCharge(l.id, { categorie: v })} options={CATEGORIES} />
      ),
    },
    {
      cle: 'mode',
      entete: 'Mode',
      largeur: 108,
      alignementGauche: true,
      rendu: (l) => (
        <Selecteur
          valeur={l.mode}
          onChange={(v) => majCharge(l.id, { mode: v })}
          options={[
            { valeur: 'montant' as const, libelle: 'En euros' },
            { valeur: 'pourcentage_ca' as const, libelle: '% du CA' },
          ]}
        />
      ),
    },
    ...annees.map((annee, i) => ({
      cle: `ex${i}`,
      entete: annee,
      largeur: 106,
      rendu: (l: LigneCharge) =>
        l.mode === 'pourcentage_ca' ? (
          <ChampTaux
            valeur={l.pourcentages[i] ?? 0}
            onChange={(v) => {
              const suivants = [...l.pourcentages];
              suivants[i] = v;
              majCharge(l.id, { pourcentages: suivants });
            }}
          />
        ) : (
          <ChampMontant
            valeur={l.montants[i] ?? 0}
            onChange={(v) => {
              const suivants = [...l.montants];
              suivants[i] = v;
              majCharge(l.id, { montants: suivants });
            }}
          />
        ),
    })),
    {
      cle: 'fixe',
      entete: 'Fixe',
      largeur: 62,
      aide: 'Une charge fixe entre dans les charges de structure du seuil de rentabilité.',
      rendu: (l) => (
        <input
          type="checkbox"
          checked={l.fixe}
          aria-label="Charge fixe"
          onChange={(e) => majCharge(l.id, { fixe: e.target.checked })}
        />
      ),
    },
  ], [annees, majCharge]);

  /*
   * Les totaux du tableau des charges, recalculés à chaque rendu.
   *
   * Ils viennent du moteur — une charge saisie en pourcentage du chiffre d'affaires n'a pas de
   * montant dans la ligne — et ne peuvent donc pas être calculés par une fonction mémoïsée
   * avec les colonnes : elle capturerait des résultats périmés, et un total périmé est un
   * chiffre faux. Voir « totauxFrais » de GrilleLignes.
   */
  const totauxCharges: Record<string, number> = {};
  annees.forEach((_, i) => {
    totauxCharges[`ex${i}`] = resultats.charges.detail.reduce((t, d) => t + (d.montants[i] ?? 0), 0);
  });

  const colonnesPersonnel: Array<Colonne<LignePersonnel>> = useMemo(() => [
    {
      cle: 'libelle',
      entete: 'Poste',
      largeur: 210,
      alignementGauche: true,
      rendu: (p) => <ChampTexte valeur={p.libelle} onChange={(v) => majPersonnel(p.id, { libelle: v })} />,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      largeur: 210,
      alignementGauche: true,
      rendu: (p) => (
        <Selecteur valeur={p.statut} onChange={(v) => majPersonnel(p.id, { statut: v })} options={STATUTS} />
      ),
    },
    ...annees.flatMap((annee, i) => [
      {
        cle: `eff${i}`,
        entete: `Effectif ${annee}`,
        largeur: 92,
        rendu: (p: LignePersonnel) => (
          <ChampNombre
            valeur={p.effectifs[i] ?? 0}
            min={0}
            pas={0.5}
            onChange={(v) => {
              const suivants = [...p.effectifs];
              suivants[i] = v;
              majPersonnel(p.id, { effectifs: suivants });
            }}
          />
        ),
      },
      {
        cle: `brut${i}`,
        entete: `Brut mensuel ${annee}`,
        largeur: 118,
        rendu: (p: LignePersonnel) => (
          <ChampMontant
            valeur={p.brutMensuel[i] ?? 0}
            onChange={(v) => {
              const suivants = [...p.brutMensuel];
              suivants[i] = v;
              majPersonnel(p.id, { brutMensuel: suivants });
            }}
          />
        ),
      },
      {
        cle: `cout${i}`,
        entete: `Coût ${annee}`,
        largeur: 106,
        rendu: (p: LignePersonnel) => <CoutPersonnel ligneId={p.id} exercice={i} />,
      },
    ]),
  ], [annees, majPersonnel]);

  /*
   * Les coûts du personnel viennent du moteur : ils sont recalculés à chaque rendu, hors des
   * colonnes mémoïsées. Voir « totauxFrais » de GrilleLignes.
   */
  const totauxPersonnel: Record<string, number> = {};
  annees.forEach((_, i) => {
    totauxPersonnel[`cout${i}`] = resultats.charges.personnel.reduce(
      (t, d) => t + (d.brut[i] ?? 0) + (d.charges[i] ?? 0),
      0,
    );
  });

  return (
    <div className="pile">
      <EnTeteSection
        titre="Charges"
        description="Les charges d’exploitation et les rémunérations, avec leur incidence directe sur le résultat."
        synthese={
          <RangeeIndicateurs>
            <CarteIndicateur
              valeur={formaterEuros(resultats.charges.totalParExercice[dernier] ?? 0)}
              libelle={`Charges externes ${annees[dernier] ?? ''}`}
            />
            <CarteIndicateur
              valeur={formaterEuros(masseSalariale[dernier] ?? 0)}
              libelle={`Masse salariale chargée ${annees[dernier] ?? ''}`}
            />
            <CarteIndicateur
              valeur={formaterEuros(resultats.seuilRentabilite[dernier]?.chargesFixes ?? 0)}
              libelle="Charges fixes de structure"
            />
            <CarteIndicateur
              valeur={formaterEuros(resultats.sig[dernier]?.excedentBrutExploitation ?? 0)}
              libelle="Excédent brut d’exploitation"
              ton={(resultats.sig[dernier]?.excedentBrutExploitation ?? 0) < 0 ? 'erreur' : 'bon'}
            />
          </RangeeIndicateurs>
        }
      />

      <BlocGrille
        titre="Charges d’exploitation"
        aide="Une charge saisie en pourcentage du chiffre d’affaires suit automatiquement l’activité."
      >
        <GrilleLignes
          colonnes={colonnesCharges}
          totauxFrais={totauxCharges}
          lignes={dossier.charges.lignes}
          cle={(l) => l.id}
          estProposee={chargeProposee}
          onSupprimer={supprimerCharge}
          onDupliquer={dupliquerCharge}
          onDeplacer={deplacerCharge}
          messageVide="Aucune charge saisie."
          libelleTotal="Total des charges externes"
          detail={detailCharge}
          actions={
            <>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('charges.lignes', {
                    libelle: 'Nouvelle charge',
                    categorie: 'services_exterieurs',
                    tauxTva: dossier.parametres.tva.tauxParDefaut,
                    tvaDeductible: dossier.parametres.tva.assujetti,
                    montants: [],
                  })
                }
              >
                + Charge
              </button>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('charges.lignes', {
                    libelle: 'Achats de marchandises',
                    categorie: 'achats_marchandises',
                    mode: 'pourcentage_ca',
                    fixe: false,
                    tauxTva: dossier.parametres.tva.tauxParDefaut,
                    tvaDeductible: dossier.parametres.tva.assujetti,
                  })
                }
              >
                + Achats en % du CA
              </button>
            </>
          }
        />
      </BlocGrille>

      <BlocGrille
        titre="Personnel et rémunérations"
        aide="Le coût affiché comprend les charges patronales, nettes des aides éventuelles."
      >
        {aUnExploitant ? (
          <Bandeau ton="alerte">
            Les prélèvements de l’exploitant ne sont pas déductibles du résultat : seules ses
            cotisations sociales le sont. Elles sont calculées sur le résultat lui-même, la
            circularité étant résolue exactement par le moteur.
          </Bandeau>
        ) : null}

        <div style={{ marginTop: aUnExploitant ? 12 : 0 }}>
          <GrilleLignes
            colonnes={colonnesPersonnel}
            totauxFrais={totauxPersonnel}
            lignes={dossier.charges.personnel}
            cle={(p) => p.id}
            estProposee={personnelPropose}
            onSupprimer={supprimerPersonnel}
            onDupliquer={dupliquerPersonnel}
            messageVide="Aucun poste de personnel saisi."
            libelleTotal="Masse salariale chargée"
            detail={detailPersonnel}
            actions={
              <>
                <button
                  className="bouton"
                  onClick={() =>
                    ajouterLigne('charges.personnel', {
                      libelle: 'Salarié',
                      statut: 'salarie',
                      effectifs: Array.from({ length: nbExercices }, () => 1),
                      nbMoisParExercice: Array.from({ length: nbExercices }, () => 12),
                    })
                  }
                >
                  + Salarié
                </button>
                <button
                  className="bouton"
                  onClick={() =>
                    ajouterLigne('charges.personnel', {
                      libelle: 'Rémunération du dirigeant',
                      statut: dossier.identite.regime === 'IS' ? 'dirigeant_assimile' : 'exploitant',
                      effectifs: Array.from({ length: nbExercices }, () => 1),
                      nbMoisParExercice: Array.from({ length: nbExercices }, () => 12),
                    })
                  }
                >
                  + Dirigeant
                </button>
              </>
            }
          />
        </div>
      </BlocGrille>
    </div>
  );
}

export default function Charges() {
  return <AvecDossier corps={CorpsCharges} />;
}

/**
 * Le coût chargé d'un poste, lu directement du magasin.
 *
 * Une cellule qui affiche un chiffre calculé ne peut pas vivre dans une colonne mémoïsée :
 * la fonction de rendu y capturerait des résultats périmés, et un coût périmé est un chiffre
 * faux. Elle s'abonne donc elle-même, avec un sélecteur qui rend un NOMBRE : la comparaison
 * par défaut de zustand suffit alors à ne la redessiner que si son propre coût a bougé.
 */
function CoutPersonnel({ ligneId, exercice }: { ligneId: string; exercice: number }) {
  const cout = useDossier((e) => {
    const d = e.resultats?.charges.personnel.find((p) => p.ligneId === ligneId);
    return (d?.brut[exercice] ?? 0) + (d?.charges[exercice] ?? 0);
  });
  return <span className="discret nombres">{formaterEuros(cout)}</span>;
}

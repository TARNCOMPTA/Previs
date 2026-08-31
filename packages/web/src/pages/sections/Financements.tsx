import {
  formaterEuros,
  formaterMontant,
  formaterPourcentage,
  LIBELLES_TYPE_APPORT,
  type Apport,
  type CreditBail,
  type Emprunt,
  type Subvention,
} from '@previs/core';
import { useCallback, useMemo, useState } from 'react';
import { ChampMontant, ChampNombre, ChampTaux, ChampTexte, Interrupteur, Selecteur } from '../../ui/champs.js';
import { Bandeau, CarteIndicateur, Modale } from '../../ui/divers.js';
import { GrilleLignes, type Colonne } from '../../ui/grille.js';
import { useDossier } from '../../store/dossier.js';
import { AvecDossier, BlocGrille, EnTeteSection, RangeeIndicateurs, type ContexteSection } from './commun.js';

const TYPES_APPORT = Object.entries(LIBELLES_TYPE_APPORT).map(([valeur, libelle]) => ({
  valeur: valeur as Apport['type'],
  libelle,
}));

/**
 * Le corps de l'écran, composant du module et non fonction écrite dans le JSX.
 *
 * C'est ce qui lui permet d'employer « useMemo » et « useCallback », donc de présenter aux
 * grilles des colonnes et des rappels stables : une frappe ne redessine alors que la ligne
 * modifiée. L'état local du tableau déplié descend ici avec lui — il ne survivait de toute
 * façon qu'au temps où le dossier est chargé.
 */
function CorpsFinancements({ dossier, resultats, annees, modifierLigne, ajouterLigne, supprimerLigne, dupliquerLigne }: ContexteSection) {
  const [tableauOuvert, setTableauOuvert] = useState<string | null>(null);
  const plan = resultats.planFinancement[0];
  const ecart = plan ? plan.ressources.total - plan.besoins.total : 0;
  const tableaux = new Map(resultats.emprunts.map((t) => [t.empruntId, t]));

  /* Stables : ce sont elles que capturent les fonctions de rendu des colonnes mémoïsées. */
  const majApport = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('financements.apports', id, champs),
    [modifierLigne],
  );
  const majEmprunt = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('financements.emprunts', id, champs),
    [modifierLigne],
  );
  const majSubvention = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('financements.subventions', id, champs),
    [modifierLigne],
  );
  const majCreditBail = useCallback(
    (id: string, champs: Record<string, unknown>) => modifierLigne('financements.creditsBaux', id, champs),
    [modifierLigne],
  );

  const colonnesApports = useMemo<Array<Colonne<Apport>>>(() => [
    {
      cle: 'libelle',
      entete: 'Libellé',
      largeur: 200,
      alignementGauche: true,
      rendu: (a) => <ChampTexte valeur={a.libelle} onChange={(v) => majApport(a.id, { libelle: v })} />,
    },
    {
      cle: 'type',
      entete: 'Nature',
      largeur: 200,
      alignementGauche: true,
      rendu: (a) => (
        <Selecteur valeur={a.type} onChange={(v) => majApport(a.id, { type: v })} options={TYPES_APPORT} />
      ),
    },
    {
      cle: 'apporteur',
      entete: 'Apporteur',
      largeur: 150,
      alignementGauche: true,
      rendu: (a) => <ChampTexte valeur={a.apporteur} onChange={(v) => majApport(a.id, { apporteur: v })} />,
    },
    {
      cle: 'montant',
      entete: 'Montant',
      largeur: 110,
      rendu: (a) => <ChampMontant valeur={a.montant} onChange={(v) => majApport(a.id, { montant: v })} />,
      total: (a) => (a.actif ? a.montant : 0),
    },
    {
      cle: 'exercice',
      entete: 'Exercice',
      largeur: 96,
      rendu: (a) => (
        <Selecteur
          valeur={String(a.exercice)}
          onChange={(v) => majApport(a.id, { exercice: Number(v) })}
          options={annees.map((x, i) => ({ valeur: String(i), libelle: x }))}
        />
      ),
    },
    {
      cle: 'mois',
      entete: 'Mois',
      largeur: 68,
      rendu: (a) => <ChampNombre valeur={a.mois} min={1} max={24} onChange={(v) => majApport(a.id, { mois: v })} />,
    },
  ], [annees, majApport]);

  const colonnesEmprunts = useMemo<Array<Colonne<Emprunt>>>(() => [
    {
      cle: 'libelle',
      entete: 'Emprunt',
      largeur: 180,
      alignementGauche: true,
      rendu: (e) => <ChampTexte valeur={e.libelle} onChange={(v) => majEmprunt(e.id, { libelle: v })} />,
    },
    {
      cle: 'organisme',
      entete: 'Organisme',
      largeur: 150,
      alignementGauche: true,
      rendu: (e) => <ChampTexte valeur={e.organisme} onChange={(v) => majEmprunt(e.id, { organisme: v })} />,
    },
    {
      cle: 'montant',
      entete: 'Montant',
      largeur: 110,
      rendu: (e) => <ChampMontant valeur={e.montant} onChange={(v) => majEmprunt(e.id, { montant: v })} />,
      total: (e) => (e.actif ? e.montant : 0),
    },
    {
      cle: 'taux',
      entete: 'Taux',
      largeur: 82,
      rendu: (e) => <ChampTaux valeur={e.tauxAnnuel} onChange={(v) => majEmprunt(e.id, { tauxAnnuel: v })} />,
    },
    {
      cle: 'duree',
      entete: 'Durée (mois)',
      largeur: 96,
      rendu: (e) => (
        <ChampNombre valeur={e.dureeMois} min={1} max={360} onChange={(v) => majEmprunt(e.id, { dureeMois: v })} />
      ),
    },
    {
      cle: 'differe',
      entete: 'Différé',
      largeur: 78,
      aide: 'Nombre de mois de franchise.',
      rendu: (e) => (
        <ChampNombre valeur={e.differeMois} min={0} max={60} onChange={(v) => majEmprunt(e.id, { differeMois: v, typeDiffere: v > 0 && e.typeDiffere === 'aucun' ? 'partiel' : e.typeDiffere })} />
      ),
    },
    {
      cle: 'mensualite',
      entete: 'Mensualité',
      largeur: 104,
      rendu: (e) => <ChiffreEmprunt empruntId={e.id} quoi="mensualite" />,
    },
    {
      cle: 'cout',
      entete: 'Coût du crédit',
      largeur: 110,
      rendu: (e) => <ChiffreEmprunt empruntId={e.id} quoi="cout" />,
    },
    {
      cle: 'tableau',
      entete: 'Échéancier',
      largeur: 96,
      rendu: (e) => (
        <button className="bouton petit" onClick={() => setTableauOuvert(e.id)} disabled={e.montant <= 0}>
          Voir
        </button>
      ),
    },
  ], [annees, majEmprunt]);

  /*
   * Mensualité et coût du crédit viennent des tableaux d'amortissement du moteur :
   * recalculés à chaque rendu, hors des colonnes mémoïsées.
   */
  const totauxEmprunts: Record<string, number> = {
    montant: dossier.financements.emprunts.reduce((t, e) => t + (e.actif ? e.montant : 0), 0),
    mensualite: resultats.emprunts.reduce((t, x) => t + x.mensualite, 0),
    cout: resultats.emprunts.reduce(
      (t, x) => t + x.echeances.reduce((s, y) => s + y.interets + y.assurance, 0),
      0,
    ),
  };

  const colonnesSubventions = useMemo<Array<Colonne<Subvention>>>(() => [
    {
      cle: 'libelle',
      entete: 'Subvention',
      largeur: 200,
      alignementGauche: true,
      rendu: (s) => <ChampTexte valeur={s.libelle} onChange={(v) => majSubvention(s.id, { libelle: v })} />,
    },
    {
      cle: 'organisme',
      entete: 'Organisme',
      largeur: 160,
      alignementGauche: true,
      rendu: (s) => <ChampTexte valeur={s.organisme} onChange={(v) => majSubvention(s.id, { organisme: v })} />,
    },
    {
      cle: 'type',
      entete: 'Type',
      largeur: 150,
      alignementGauche: true,
      rendu: (s) => (
        <Selecteur
          valeur={s.type}
          onChange={(v) => majSubvention(s.id, { type: v })}
          options={[
            { valeur: 'investissement' as const, libelle: 'Investissement' },
            { valeur: 'exploitation' as const, libelle: 'Exploitation' },
          ]}
        />
      ),
    },
    {
      cle: 'montant',
      entete: 'Montant',
      largeur: 110,
      rendu: (s) => <ChampMontant valeur={s.montant} onChange={(v) => majSubvention(s.id, { montant: v })} />,
      total: (s) => (s.actif ? s.montant : 0),
    },
    {
      cle: 'exercice',
      entete: 'Exercice',
      largeur: 96,
      rendu: (s) => (
        <Selecteur
          valeur={String(s.exercice)}
          onChange={(v) => majSubvention(s.id, { exercice: Number(v) })}
          options={annees.map((x, i) => ({ valeur: String(i), libelle: x }))}
        />
      ),
    },
    {
      cle: 'reprise',
      entete: 'Reprise (ans)',
      largeur: 104,
      aide: 'Étalement de la subvention d’investissement au compte de résultat. 0 = en une fois.',
      rendu: (s) => (
        <ChampNombre
          valeur={s.repriseSurAnnees}
          min={0}
          max={20}
          onChange={(v) => majSubvention(s.id, { repriseSurAnnees: v })}
          desactive={s.type === 'exploitation'}
        />
      ),
    },
  ], [annees, majSubvention]);

  const colonnesCreditsBaux = useMemo<Array<Colonne<CreditBail>>>(() => [
    {
      cle: 'libelle',
      entete: 'Contrat',
      largeur: 200,
      alignementGauche: true,
      rendu: (c) => <ChampTexte valeur={c.libelle} onChange={(v) => majCreditBail(c.id, { libelle: v })} />,
    },
    {
      cle: 'valeur',
      entete: 'Valeur du bien',
      largeur: 116,
      rendu: (c) => <ChampMontant valeur={c.valeurBien} onChange={(v) => majCreditBail(c.id, { valeurBien: v })} />,
    },
    {
      cle: 'loyer',
      entete: 'Loyer mensuel HT',
      largeur: 126,
      rendu: (c) => (
        <ChampMontant valeur={c.loyerMensuelHT} onChange={(v) => majCreditBail(c.id, { loyerMensuelHT: v })} />
      ),
      total: (c) => (c.actif ? c.loyerMensuelHT : 0),
    },
    {
      cle: 'duree',
      entete: 'Durée (mois)',
      largeur: 100,
      rendu: (c) => (
        <ChampNombre valeur={c.dureeMois} min={1} max={240} onChange={(v) => majCreditBail(c.id, { dureeMois: v })} />
      ),
    },
    {
      cle: 'depot',
      entete: 'Dépôt de garantie',
      largeur: 126,
      rendu: (c) => (
        <ChampMontant valeur={c.depotGarantie} onChange={(v) => majCreditBail(c.id, { depotGarantie: v })} />
      ),
    },
    {
      cle: 'option',
      entete: 'Option d’achat',
      largeur: 116,
      rendu: (c) => (
        <ChampMontant valeur={c.valeurResiduelle} onChange={(v) => majCreditBail(c.id, { valeurResiduelle: v })} />
      ),
    },
  ], [annees, majCreditBail]);

  const emprunt = tableauOuvert ? dossier.financements.emprunts.find((e) => e.id === tableauOuvert) : null;
  const tableau = tableauOuvert ? tableaux.get(tableauOuvert) : null;

  return (
    <div className="pile">
      <EnTeteSection
        titre="Financement"
        description="Les ressources mobilisées face aux besoins du démarrage : apports, emprunts, subventions et crédits-baux."
        synthese={
          <>
            <RangeeIndicateurs>
              <CarteIndicateur
                valeur={formaterEuros(plan?.besoins.total ?? 0)}
                libelle="Besoins du premier exercice"
              />
              <CarteIndicateur
                valeur={formaterEuros(plan?.ressources.total ?? 0)}
                libelle="Ressources mobilisées"
              />
              <CarteIndicateur
                valeur={formaterEuros(ecart)}
                libelle={ecart < 0 ? 'Financement manquant' : 'Marge de financement'}
                ton={ecart < 0 ? 'erreur' : 'bon'}
              />
              <CarteIndicateur
                valeur={formaterEuros(resultats.bilans[0]?.passif.empruntsDettesFinancieres ?? 0)}
                libelle="Endettement à la première clôture"
              />
            </RangeeIndicateurs>
            {ecart < 0 ? (
              <Bandeau ton="erreur">
                Les ressources du premier exercice ne couvrent pas les besoins : il manque{' '}
                <strong>{formaterEuros(-ecart)}</strong>. C’est le premier chiffre que
                regardera le banquier.
              </Bandeau>
            ) : null}
          </>
        }
      />

      <BlocGrille titre="Apports et comptes courants">
        <GrilleLignes
          colonnes={colonnesApports}
          lignes={dossier.financements.apports}
          cle={(a) => a.id}
          estProposee={(a) => a.origine === 'llm'}
          onSupprimer={(a) => supprimerLigne('financements.apports', a.id)}
          onDupliquer={(a) => dupliquerLigne('financements.apports', a.id)}
          messageVide="Aucun apport saisi."
          libelleTotal="Total des apports"
          detail={(a) => (
            <div className="pile">
              <div className="grille-champs">
                {annees.map((annee, i) => (
                  <ChampMontant
                    key={i}
                    libelle={`Remboursement ${annee}`}
                    valeur={a.remboursements[i] ?? 0}
                    onChange={(v) => {
                      const suivants = [...a.remboursements];
                      suivants[i] = v;
                      majApport(a.id, { remboursements: suivants });
                    }}
                  />
                ))}
                <ChampTexte
                  libelle="Note"
                  valeur={a.note ?? ''}
                  onChange={(v) => majApport(a.id, { note: v || undefined })}
                />
                <Interrupteur libelle="Ligne active" valeur={a.actif} onChange={(v) => majApport(a.id, { actif: v })} />
              </div>
              <div className="aide-champ">
                Le remboursement d’un compte courant est un besoin du plan de financement ; un
                apport en nature ne donne lieu à aucun mouvement de trésorerie.
              </div>
            </div>
          )}
          actions={
            <>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('financements.apports', {
                    libelle: dossier.identite.regime === 'IS' ? 'Capital social' : 'Apport personnel',
                    type: dossier.identite.regime === 'IS' ? 'capital' : 'apport_personnel',
                  })
                }
              >
                + Apport
              </button>
              <button
                className="bouton"
                onClick={() =>
                  ajouterLigne('financements.apports', {
                    libelle: 'Compte courant d’associé',
                    type: 'compte_courant',
                  })
                }
              >
                + Compte courant
              </button>
            </>
          }
        />
      </BlocGrille>

      <BlocGrille
        titre="Emprunts"
        aide="Échéances constantes. Le différé partiel ne règle que les intérêts ; le différé total capitalise les intérêts."
      >
        <GrilleLignes
          colonnes={colonnesEmprunts}
          totauxFrais={totauxEmprunts}
          lignes={dossier.financements.emprunts}
          cle={(e) => e.id}
          estProposee={(e) => e.origine === 'llm'}
          onSupprimer={(e) => supprimerLigne('financements.emprunts', e.id)}
          onDupliquer={(e) => dupliquerLigne('financements.emprunts', e.id)}
          messageVide="Aucun emprunt saisi."
          libelleTotal="Total emprunté"
          detail={(e) => (
            <div className="grille-champs">
              <Selecteur
                libelle="Exercice de déblocage"
                valeur={String(e.exerciceDeblocage)}
                onChange={(v) => majEmprunt(e.id, { exerciceDeblocage: Number(v) })}
                options={annees.map((x, i) => ({ valeur: String(i), libelle: x }))}
              />
              <ChampNombre
                libelle="Mois de déblocage"
                valeur={e.moisDeblocage}
                min={1}
                max={24}
                onChange={(v) => majEmprunt(e.id, { moisDeblocage: v })}
              />
              <Selecteur
                libelle="Périodicité"
                valeur={e.periodicite}
                onChange={(v) => majEmprunt(e.id, { periodicite: v })}
                options={[
                  { valeur: 'mensuelle' as const, libelle: 'Mensuelle' },
                  { valeur: 'trimestrielle' as const, libelle: 'Trimestrielle' },
                  { valeur: 'annuelle' as const, libelle: 'Annuelle' },
                ]}
              />
              <Selecteur
                libelle="Type de différé"
                valeur={e.typeDiffere}
                onChange={(v) => majEmprunt(e.id, { typeDiffere: v })}
                options={[
                  { valeur: 'aucun' as const, libelle: 'Aucun' },
                  { valeur: 'partiel' as const, libelle: 'Partiel — intérêts seuls' },
                  { valeur: 'total' as const, libelle: 'Total — intérêts capitalisés' },
                ]}
              />
              <ChampTaux
                libelle="Taux d’assurance annuel"
                valeur={e.tauxAssuranceAnnuel}
                onChange={(v) => majEmprunt(e.id, { tauxAssuranceAnnuel: v })}
              />
              <Interrupteur
                libelle="Assurance sur capital restant dû"
                valeur={e.assuranceSurCapitalRestant}
                onChange={(v) => majEmprunt(e.id, { assuranceSurCapitalRestant: v })}
                aide="Sinon, l’assurance porte sur le capital initial."
              />
              <ChampMontant
                libelle="Frais de dossier"
                valeur={e.fraisDossier}
                onChange={(v) => majEmprunt(e.id, { fraisDossier: v })}
              />
              <ChampMontant
                libelle="Frais de garantie"
                valeur={e.fraisGarantie}
                onChange={(v) => majEmprunt(e.id, { fraisGarantie: v })}
              />
              <Interrupteur libelle="Ligne active" valeur={e.actif} onChange={(v) => majEmprunt(e.id, { actif: v })} />
            </div>
          )}
          actions={
            <button
              className="bouton"
              onClick={() =>
                ajouterLigne('financements.emprunts', {
                  libelle: 'Prêt bancaire',
                  montant: 0,
                  tauxAnnuel: 3.5,
                  dureeMois: 84,
                })
              }
            >
              + Emprunt
            </button>
          }
        />
      </BlocGrille>

      <BlocGrille titre="Subventions">
        <GrilleLignes
          colonnes={colonnesSubventions}
          lignes={dossier.financements.subventions}
          cle={(s) => s.id}
          estProposee={(s) => s.origine === 'llm'}
          onSupprimer={(s) => supprimerLigne('financements.subventions', s.id)}
          messageVide="Aucune subvention saisie."
          libelleTotal="Total des subventions"
          actions={
            <button
              className="bouton"
              onClick={() => ajouterLigne('financements.subventions', { libelle: 'Subvention' })}
            >
              + Subvention
            </button>
          }
        />
      </BlocGrille>

      <BlocGrille
        titre="Crédits-baux et locations financières"
        aide="Le bien n’entre pas à l’actif : seul le loyer est une charge externe."
      >
        <GrilleLignes
          colonnes={colonnesCreditsBaux}
          lignes={dossier.financements.creditsBaux}
          cle={(c) => c.id}
          estProposee={(c) => c.origine === 'llm'}
          onSupprimer={(c) => supprimerLigne('financements.creditsBaux', c.id)}
          messageVide="Aucun contrat de crédit-bail."
          libelleTotal="Total des loyers mensuels"
          detail={(c) => (
            <div className="grille-champs">
              <ChampTexte
                libelle="Organisme"
                valeur={c.organisme}
                onChange={(v) => majCreditBail(c.id, { organisme: v })}
              />
              <Selecteur
                libelle="Exercice de début"
                valeur={String(c.exerciceDebut)}
                onChange={(v) => majCreditBail(c.id, { exerciceDebut: Number(v) })}
                options={annees.map((x, i) => ({ valeur: String(i), libelle: x }))}
              />
              <ChampNombre
                libelle="Mois de début"
                valeur={c.moisDebut}
                min={1}
                max={24}
                onChange={(v) => majCreditBail(c.id, { moisDebut: v })}
              />
              <ChampTaux libelle="Taux de TVA" valeur={c.tauxTva} onChange={(v) => majCreditBail(c.id, { tauxTva: v })} />
            </div>
          )}
          actions={
            <button
              className="bouton"
              onClick={() => ajouterLigne('financements.creditsBaux', { libelle: 'Crédit-bail' })}
            >
              + Crédit-bail
            </button>
          }
        />
      </BlocGrille>

      {emprunt && tableau ? (
        <Modale titre={`Échéancier — ${emprunt.libelle}`} onFermer={() => setTableauOuvert(null)} largeur={860}>
          <p className="discret">
            {formaterEuros(emprunt.montant)} sur {emprunt.dureeMois} mois au taux de{' '}
            {formaterPourcentage(emprunt.tauxAnnuel, 2)} — mensualité de{' '}
            {formaterEuros(tableau.mensualite, 2)} hors assurance.
          </p>
          <div className="defilement-horizontal" style={{ maxHeight: '55vh' }}>
            <table className="etat">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th>Capital début</th>
                  <th>Échéance</th>
                  <th>Intérêts</th>
                  <th>Capital</th>
                  <th>Assurance</th>
                  <th>Capital restant dû</th>
                </tr>
              </thead>
              <tbody>
                {tableau.echeances.map((e, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left' }}>{resultats.libellesMois[e.moisAbsolu] ?? e.moisAbsolu + 1}</td>
                    <td>{formaterMontant(e.capitalDebut)}</td>
                    <td>{formaterMontant(e.echeance)}</td>
                    <td>{formaterMontant(e.interets)}</td>
                    <td className={e.capital < 0 ? 'negatif' : undefined}>{formaterMontant(e.capital)}</td>
                    <td>{formaterMontant(e.assurance)}</td>
                    <td>{formaterMontant(e.capitalRestantDu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modale>
      ) : null}
    </div>
  );
}

/** Écran de saisie des financements : apports, emprunts, subventions, crédits-baux. */
export default function Financements() {
  return <AvecDossier corps={CorpsFinancements} />;
}

/**
 * Un chiffre du tableau d'amortissement d'un emprunt, lu directement du magasin.
 *
 * Mensualité et coût du crédit sont calculés par le moteur : une colonne mémoïsée en
 * capturerait une version périmée. Le sélecteur rend un NOMBRE, donc la cellule ne se
 * redessine que si son propre chiffre a bougé.
 */
function ChiffreEmprunt({ empruntId, quoi }: { empruntId: string; quoi: 'mensualite' | 'cout' }) {
  const valeur = useDossier((e) => {
    const t = e.resultats?.emprunts.find((x) => x.empruntId === empruntId);
    if (!t) return 0;
    return quoi === 'mensualite'
      ? t.mensualite
      : t.echeances.reduce((s, x) => s + x.interets + x.assurance, 0);
  });
  return (
    <span className="discret nombres">{formaterEuros(valeur, quoi === 'mensualite' ? 2 : 0)}</span>
  );
}

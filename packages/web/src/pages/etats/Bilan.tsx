import { formaterEuros } from '@previs/core';
import { useDossier } from '../../store/dossier.js';
import { Bandeau } from '../../ui/divers.js';
import { TableauEtat, type LigneEtat } from '../../ui/grille.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Bilans prévisionnels et besoin en fonds de roulement. */
export default function Bilan() {
  const regime = useDossier((e) => e.dossier?.identite.regime ?? 'IS');
  const societe = regime === 'IS';

  return (
    <AvecResultats
      titre="Bilan et besoin en fonds de roulement"
      description="La situation patrimoniale à chaque clôture, et le financement du cycle d’exploitation."
      enfant={(r, annees) => {
        const b = r.bilans;
        const desequilibre = b.filter((x) => Math.abs(x.ecart) > 1);

        const actif: LigneEtat[] = [
          { libelle: 'ACTIF', valeurs: [], style: 'groupe' },
          { libelle: 'Immobilisations incorporelles', valeurs: b.map((x) => x.actif.immobilisationsIncorporelles), style: 'detail' },
          { libelle: 'Immobilisations corporelles', valeurs: b.map((x) => x.actif.immobilisationsCorporelles), style: 'detail' },
          { libelle: 'Immobilisations financières', valeurs: b.map((x) => x.actif.immobilisationsFinancieres), style: 'detail' },
          { libelle: 'Amortissements cumulés', valeurs: b.map((x) => -x.actif.amortissements), style: 'detail' },
          { libelle: 'Immobilisations nettes', valeurs: b.map((x) => x.actif.immobilisationsNettes), style: 'sous-total' },
          { libelle: 'Stocks', valeurs: b.map((x) => x.actif.stocks), style: 'detail' },
          { libelle: 'Créances clients', valeurs: b.map((x) => x.actif.creancesClients), style: 'detail' },
          { libelle: 'Autres créances', valeurs: b.map((x) => x.actif.autresCreances), style: 'detail' },
          { libelle: 'Disponibilités', valeurs: b.map((x) => x.actif.disponibilites), style: 'detail' },
          { libelle: 'TOTAL DE L’ACTIF', valeurs: b.map((x) => x.actif.total), style: 'total' },
        ];

        const passif: LigneEtat[] = [
          { libelle: 'PASSIF', valeurs: [], style: 'groupe' },
          {
            libelle: societe ? 'Capital social' : 'Compte de l’exploitant',
            valeurs: b.map((x) => x.passif.capitalSocial),
            style: 'detail',
            aide: societe
              ? undefined
              : 'Apports cumulés et résultats conservés, diminués des prélèvements personnels.',
          },
          ...(societe
            ? [
                { libelle: 'Primes et réserves', valeurs: b.map((x) => x.passif.primesEtReserves), style: 'detail' as const },
                { libelle: 'Report à nouveau', valeurs: b.map((x) => x.passif.reportANouveau), style: 'detail' as const },
              ]
            : []),
          { libelle: 'Résultat de l’exercice', valeurs: b.map((x) => x.passif.resultatExercice), style: 'detail' },
          { libelle: 'Subventions d’investissement', valeurs: b.map((x) => x.passif.subventionsInvestissement), style: 'detail' },
          { libelle: 'Capitaux propres', valeurs: b.map((x) => x.passif.capitauxPropres), style: 'sous-total' },
          { libelle: 'Comptes courants d’associés', valeurs: b.map((x) => x.passif.comptesCourants), style: 'detail' },
          { libelle: 'Emprunts et dettes financières', valeurs: b.map((x) => x.passif.empruntsDettesFinancieres), style: 'detail' },
          { libelle: 'Dettes fournisseurs', valeurs: b.map((x) => x.passif.dettesFournisseurs), style: 'detail' },
          { libelle: 'Dettes fiscales et sociales', valeurs: b.map((x) => x.passif.dettesFiscalesSociales), style: 'detail' },
          { libelle: 'Autres dettes', valeurs: b.map((x) => x.passif.autresDettes), style: 'detail' },
          { libelle: 'TOTAL DU PASSIF', valeurs: b.map((x) => x.passif.total), style: 'total' },
        ];

        const ecart: LigneEtat[] = [
          { libelle: 'ÉCART ACTIF / PASSIF', valeurs: b.map((x) => x.ecart), style: 'total' },
        ];

        const f = r.bfr;
        const lignesBfr: LigneEtat[] = [
          { libelle: 'Besoins d’exploitation', valeurs: [], style: 'groupe' },
          { libelle: 'Stocks', valeurs: f.map((x) => x.stocks), style: 'detail' },
          { libelle: 'Créances clients', valeurs: f.map((x) => x.creancesClients), style: 'detail' },
          { libelle: 'Crédit de TVA', valeurs: f.map((x) => x.creditTva), style: 'detail' },
          { libelle: 'Autres créances', valeurs: f.map((x) => x.autresCreances), style: 'detail' },
          { libelle: 'Total des besoins', valeurs: f.map((x) => x.totalBesoins), style: 'sous-total' },
          { libelle: 'Ressources d’exploitation', valeurs: [], style: 'groupe' },
          { libelle: 'Dettes fournisseurs', valeurs: f.map((x) => x.dettesFournisseurs), style: 'detail' },
          { libelle: 'TVA à décaisser', valeurs: f.map((x) => x.tvaADecaisser), style: 'detail' },
          { libelle: 'Dettes sociales', valeurs: f.map((x) => x.dettesSociales), style: 'detail' },
          { libelle: 'Dettes fiscales', valeurs: f.map((x) => x.dettesFiscales), style: 'detail' },
          { libelle: 'Autres dettes', valeurs: f.map((x) => x.autresDettes), style: 'detail' },
          { libelle: 'Total des ressources', valeurs: f.map((x) => x.totalRessources), style: 'sous-total' },
          { libelle: 'BESOIN EN FONDS DE ROULEMENT', valeurs: f.map((x) => x.bfr), style: 'total' },
          { libelle: 'Variation de l’exercice', valeurs: f.map((x) => x.variation), style: 'detail' },
          { libelle: 'En jours de chiffre d’affaires', valeurs: f.map((x) => x.enJoursCA), style: 'detail' },
        ];

        return (
          <>
            {desequilibre.length > 0 ? (
              <Bandeau ton="erreur">
                Le bilan ne s’équilibre pas sur {desequilibre.length} exercice(s), pour un écart
                maximal de {formaterEuros(Math.max(...desequilibre.map((x) => Math.abs(x.ecart))))}.
                Cet écart n’est jamais absorbé par un compte d’attente : sa cause est à chercher
                dans le besoin en fonds de roulement ou dans les flux de trésorerie.
              </Bandeau>
            ) : (
              <Bandeau ton="succes">
                Le bilan est équilibré sur l’ensemble des exercices, à l’euro près.
              </Bandeau>
            )}

            <BlocEtat titre="Bilans prévisionnels">
              <TableauEtat
                entetes={['Poste', ...annees]}
                lignes={[...actif, ...passif, ...(desequilibre.length > 0 ? ecart : [])]}
                masquerNuls={false}
              />
            </BlocEtat>

            <BlocEtat
              titre="Besoin en fonds de roulement"
              aide="Ces postes sont exactement ceux du bilan : c’est cette identité qui garantit son équilibre."
            >
              <TableauEtat entetes={['Poste', ...annees]} lignes={lignesBfr} masquerNuls={false} />
            </BlocEtat>
          </>
        );
      }}
    />
  );
}

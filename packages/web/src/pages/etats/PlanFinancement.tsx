import { Bandeau } from '../../ui/divers.js';
import { TableauEtat, type LigneEtat } from '../../ui/grille.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Plan de financement : les besoins durables face aux ressources stables. */
export default function PlanFinancement() {
  return (
    <AvecResultats
      titre="Plan de financement"
      description="Les besoins durables de chaque exercice face aux ressources mobilisées."
      enfant={(r, annees) => {
        const p = r.planFinancement;
        const lignes: LigneEtat[] = [
          { libelle: 'Besoins', valeurs: [], style: 'groupe' },
          { libelle: 'Investissements', valeurs: p.map((x) => x.besoins.investissements), style: 'detail' },
          {
            libelle: 'Remboursements d’emprunts',
            valeurs: p.map((x) => x.besoins.remboursementsEmprunts),
            style: 'detail',
          },
          {
            libelle: 'Remboursements de comptes courants',
            valeurs: p.map((x) => x.besoins.remboursementsComptesCourants),
            style: 'detail',
          },
          {
            libelle: 'Variation du besoin en fonds de roulement',
            valeurs: p.map((x) => x.besoins.variationBfr),
            style: 'detail',
          },
          {
            libelle: 'Distributions et prélèvements',
            valeurs: p.map((x) => x.besoins.distributions),
            style: 'detail',
          },
          { libelle: 'Total des besoins', valeurs: p.map((x) => x.besoins.total), style: 'sous-total' },

          { libelle: 'Ressources', valeurs: [], style: 'groupe' },
          { libelle: 'Capacité d’autofinancement', valeurs: p.map((x) => x.ressources.caf), style: 'detail' },
          { libelle: 'Apports et comptes courants', valeurs: p.map((x) => x.ressources.apports), style: 'detail' },
          { libelle: 'Emprunts débloqués', valeurs: p.map((x) => x.ressources.emprunts), style: 'detail' },
          { libelle: 'Subventions d’investissement', valeurs: p.map((x) => x.ressources.subventions), style: 'detail' },
          { libelle: 'Cessions d’immobilisations', valeurs: p.map((x) => x.ressources.cessions), style: 'detail' },
          { libelle: 'Total des ressources', valeurs: p.map((x) => x.ressources.total), style: 'sous-total' },

          { libelle: 'SOLDE DE L’EXERCICE', valeurs: p.map((x) => x.solde), style: 'total' },
          { libelle: 'Solde cumulé', valeurs: p.map((x) => x.soldeCumule), style: 'sous-total' },
        ];

        const cumuleNegatif = p.some((x) => x.soldeCumule < 0);

        return (
          <BlocEtat
            titre="Plan de financement"
            aide="Le stock de départ est financé par la variation du besoin en fonds de roulement, où il figure déjà."
          >
            {cumuleNegatif ? (
              <div style={{ marginBottom: 12 }}>
                <Bandeau ton="erreur">
                  Le solde cumulé devient négatif : les ressources mobilisées ne suffisent pas à
                  couvrir les besoins de la période.
                </Bandeau>
              </div>
            ) : null}
            <TableauEtat entetes={['Poste', ...annees]} lignes={lignes} masquerNuls={false} />
          </BlocEtat>
        );
      }}
    />
  );
}

import { formaterEuros, formaterMontant } from '@previs/core';
import { CarteIndicateur, Graphique } from '../../ui/divers.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Tableau de trésorerie mensuel, un bloc par exercice. */
export default function Tresorerie() {
  return (
    <AvecResultats
      titre="Trésorerie mensuelle"
      description="Les encaissements et décaissements mois par mois, et le solde qui en résulte."
      enfant={(r, annees) => {
        const mensuelle = r.tresorerie.mensuelle;
        const soldes = mensuelle.map((m) => m.soldeFinal);
        const moisNegatifs = mensuelle.filter((m) => m.soldeFinal < 0).length;

        const lignesPostes: Array<{ libelle: string; extraire: (m: (typeof mensuelle)[number]) => number; style?: string }> = [
          { libelle: 'Solde initial', extraire: (m) => m.soldeInitial, style: 'sous-total' },
          { libelle: 'Ventes encaissées', extraire: (m) => m.encaissements.ventes },
          { libelle: 'Apports', extraire: (m) => m.encaissements.apports },
          { libelle: 'Emprunts débloqués', extraire: (m) => m.encaissements.emprunts },
          { libelle: 'Subventions', extraire: (m) => m.encaissements.subventions },
          { libelle: 'Cessions', extraire: (m) => m.encaissements.cessions },
          { libelle: 'Remboursements de TVA', extraire: (m) => m.encaissements.tvaRemboursee },
          { libelle: 'Autres encaissements', extraire: (m) => m.encaissements.autres },
          { libelle: 'Total des encaissements', extraire: (m) => m.encaissements.total, style: 'sous-total' },
          { libelle: 'Achats et charges', extraire: (m) => m.decaissements.achatsEtCharges },
          { libelle: 'Rémunérations', extraire: (m) => m.decaissements.salaires },
          { libelle: 'Charges sociales', extraire: (m) => m.decaissements.chargesSociales },
          { libelle: 'Investissements', extraire: (m) => m.decaissements.investissements },
          { libelle: 'Échéances d’emprunts', extraire: (m) => m.decaissements.echeancesEmprunts },
          { libelle: 'TVA', extraire: (m) => m.decaissements.tva },
          { libelle: 'Impôts et taxes', extraire: (m) => m.decaissements.impots },
          { libelle: 'Distributions', extraire: (m) => m.decaissements.distributions },
          { libelle: 'Autres décaissements', extraire: (m) => m.decaissements.autres },
          { libelle: 'Total des décaissements', extraire: (m) => m.decaissements.total, style: 'sous-total' },
          { libelle: 'SOLDE DE FIN DE MOIS', extraire: (m) => m.soldeFinal, style: 'total' },
        ];

        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <CarteIndicateur
                valeur={formaterEuros(r.tresorerie.soldeMinimum)}
                libelle="Solde le plus bas"
                detail={r.libellesMois[r.tresorerie.moisSoldeMinimum]}
                ton={r.tresorerie.soldeMinimum < 0 ? 'erreur' : 'bon'}
              />
              <CarteIndicateur
                valeur={String(moisNegatifs)}
                libelle="Mois en trésorerie négative"
                ton={moisNegatifs > 0 ? 'erreur' : 'bon'}
              />
              {r.tresorerie.soldeFinParExercice.map((solde, i) => (
                <CarteIndicateur
                  key={i}
                  valeur={formaterEuros(solde)}
                  libelle={`Trésorerie fin ${annees[i]}`}
                  ton={solde < 0 ? 'erreur' : 'neutre'}
                />
              ))}
            </div>

            <BlocEtat titre="Évolution du solde de trésorerie">
              <Graphique
                type="courbe"
                libelles={r.libellesMois}
                series={[{ nom: 'Solde cumulé', valeurs: soldes }]}
                hauteur={200}
              />
            </BlocEtat>

            {r.exercices.map((exercice) => {
              const mois = mensuelle.slice(
                exercice.moisDebutAbsolu,
                exercice.moisDebutAbsolu + exercice.nbMois,
              );
              return (
                <BlocEtat key={exercice.index} titre={`Exercice ${exercice.libelle}`}>
                  <div className="defilement-horizontal">
                    <table className="etat" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ minWidth: 190 }}>Poste</th>
                          {mois.map((m) => (
                            <th key={m.moisAbsolu} style={{ minWidth: 84 }}>
                              {m.libelle}
                            </th>
                          ))}
                          <th style={{ minWidth: 96 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lignesPostes.map((ligne) => {
                          const valeurs = mois.map(ligne.extraire);
                          const total =
                            ligne.style === 'total' || ligne.libelle === 'Solde initial'
                              ? null
                              : valeurs.reduce((t, v) => t + v, 0);
                          if (!ligne.style && valeurs.every((v) => Math.round(v) === 0)) return null;
                          return (
                            <tr key={ligne.libelle} className={ligne.style}>
                              <td className={ligne.style ? undefined : 'detail'}>{ligne.libelle}</td>
                              {valeurs.map((v, i) => (
                                <td key={i} className={v < 0 ? 'negatif' : undefined}>
                                  {Math.round(v) === 0 ? '—' : formaterMontant(v)}
                                </td>
                              ))}
                              <td className={(total ?? 0) < 0 ? 'negatif' : undefined}>
                                {total === null ? '—' : formaterMontant(total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </BlocEtat>
              );
            })}
          </>
        );
      }}
    />
  );
}

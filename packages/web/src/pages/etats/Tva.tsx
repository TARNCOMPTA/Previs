import { formaterMontant } from '@previs/core';
import { useDossier } from '../../store/dossier.js';
import { Bandeau, ZoneVide } from '../../ui/divers.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Déclarations de TVA sur l'horizon du prévisionnel. */
export default function Tva() {
  const assujetti = useDossier((e) => e.dossier?.parametres.tva.assujetti ?? true);
  const regime = useDossier((e) => e.dossier?.parametres.tva.regime ?? 'mensuel');

  return (
    <AvecResultats
      titre="Taxe sur la valeur ajoutée"
      description="La TVA collectée, la TVA déductible et le montant à décaisser à chaque échéance."
      enfant={(r, annees) => {
        if (!assujetti || regime === 'franchise' || r.tva.periodes.length === 0) {
          return (
            <section className="carte">
              <ZoneVide titre="Ce dossier n’est pas assujetti à la TVA.">
                Les montants saisis sont considérés comme définitifs. Le régime se modifie dans la
                section Autres, onglet Hypothèses.
              </ZoneVide>
            </section>
          );
        }

        const credit = r.tva.periodes.some((p) => p.creditReporte > 0);

        return (
          <>
            {credit ? (
              <Bandeau ton="alerte">
                Le dossier dégage un crédit de TVA sur certaines périodes. Il est reporté sur la
                période suivante ; pour en demander le remboursement, décocher « Crédit de TVA
                reporté » dans les hypothèses.
              </Bandeau>
            ) : null}

            {r.exercices.map((exercice) => {
              const periodes = r.tva.periodes.filter((p) => p.exercice === exercice.index);
              if (periodes.length === 0) return null;
              const totaux = periodes.reduce(
                (t, p) => ({
                  collectee: t.collectee + p.collectee,
                  bs: t.bs + p.deductibleBiensServices,
                  immo: t.immo + p.deductibleImmobilisations,
                  solde: t.solde + p.solde,
                  decaisser: t.decaisser + p.aDecaisser,
                }),
                { collectee: 0, bs: 0, immo: 0, solde: 0, decaisser: 0 },
              );

              return (
                <BlocEtat key={exercice.index} titre={`Exercice ${exercice.libelle}`}>
                  <div className="defilement-horizontal">
                    <table className="etat">
                      <thead>
                        <tr>
                          <th>Période</th>
                          <th>TVA collectée</th>
                          <th>Déductible biens et services</th>
                          <th>Déductible immobilisations</th>
                          <th>Solde</th>
                          <th>Crédit reporté</th>
                          <th>À décaisser</th>
                          <th>Décaissée en</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodes.map((p) => (
                          <tr key={p.moisAbsolu}>
                            <td style={{ textAlign: 'left' }}>{p.libelle}</td>
                            <td>{formaterMontant(p.collectee)}</td>
                            <td>{formaterMontant(p.deductibleBiensServices)}</td>
                            <td>{formaterMontant(p.deductibleImmobilisations)}</td>
                            <td className={p.solde < 0 ? 'negatif' : undefined}>{formaterMontant(p.solde)}</td>
                            <td>{p.creditReporte ? formaterMontant(p.creditReporte) : '—'}</td>
                            <td>{p.aDecaisser ? formaterMontant(p.aDecaisser) : '—'}</td>
                            <td style={{ textAlign: 'left' }} className="discret">
                              {r.libellesMois[p.moisDecaissement] ?? '—'}
                            </td>
                          </tr>
                        ))}
                        <tr className="total">
                          <td>Total de l’exercice</td>
                          <td>{formaterMontant(totaux.collectee)}</td>
                          <td>{formaterMontant(totaux.bs)}</td>
                          <td>{formaterMontant(totaux.immo)}</td>
                          <td>{formaterMontant(totaux.solde)}</td>
                          <td>—</td>
                          <td>{formaterMontant(totaux.decaisser)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </BlocEtat>
              );
            })}

            <BlocEtat titre="Synthèse annuelle">
              <table className="etat">
                <thead>
                  <tr>
                    <th>Exercice</th>
                    <th>TVA collectée</th>
                    <th>TVA déductible</th>
                    <th>TVA due</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tva.parExercice.map((t, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'left' }}>{annees[i]}</td>
                      <td>{formaterMontant(t.collectee)}</td>
                      <td>{formaterMontant(t.deductible)}</td>
                      <td className={t.due < 0 ? 'negatif' : undefined}>{formaterMontant(t.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </BlocEtat>
          </>
        );
      }}
    />
  );
}

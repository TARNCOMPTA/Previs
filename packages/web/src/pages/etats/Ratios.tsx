import { formaterEuros, formaterMontant, formaterPourcentage } from '@previs/core';
import { InfoBulle } from '../../ui/champs.js';
import { CarteIndicateur, Graphique } from '../../ui/divers.js';
import { TableauEtat, type LigneEtat } from '../../ui/grille.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Ratios d'exploitation et de structure, et seuil de rentabilité. */
export default function Ratios() {
  return (
    <AvecResultats
      titre="Ratios et seuil de rentabilité"
      description="Les indicateurs que regarde un banquier, et le chiffre d’affaires à atteindre pour couvrir les charges."
      enfant={(r, annees) => {
        const s = r.seuilRentabilite;
        const dernier = s.length - 1;

        const lignesSeuil: LigneEtat[] = [
          { libelle: 'Chiffre d’affaires', valeurs: s.map((x) => x.chiffreAffaires), style: 'detail' },
          { libelle: 'Charges variables', valeurs: s.map((x) => x.chargesVariables), style: 'detail' },
          { libelle: 'Marge sur coût variable', valeurs: s.map((x) => x.margeSurCoutVariable), style: 'sous-total' },
          { libelle: 'Charges fixes', valeurs: s.map((x) => x.chargesFixes), style: 'detail' },
          { libelle: 'SEUIL DE RENTABILITÉ', valeurs: s.map((x) => x.seuil), style: 'total' },
          {
            libelle: 'Seuil de rentabilité financier',
            valeurs: s.map((x) => x.seuilFinancier),
            style: 'sous-total',
            aide: 'Inclut les remboursements d’emprunts en capital.',
          },
          { libelle: 'Marge de sécurité', valeurs: s.map((x) => x.margeSecurite), style: 'detail' },
        ];

        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <CarteIndicateur
                valeur={formaterEuros(s[dernier]?.seuil ?? 0)}
                libelle={`Seuil de rentabilité ${annees[dernier] ?? ''}`}
              />
              <CarteIndicateur
                valeur={`${s[dernier]?.pointMortJours ?? 0} jours`}
                libelle="Point mort"
                detail="Nombre de jours d’activité pour couvrir les charges fixes"
              />
              <CarteIndicateur
                valeur={formaterPourcentage(s[dernier]?.tauxMargeSurCoutVariable ?? 0)}
                libelle="Taux de marge sur coût variable"
              />
              <CarteIndicateur
                valeur={formaterEuros(s[dernier]?.margeSecurite ?? 0)}
                libelle="Marge de sécurité"
                ton={(s[dernier]?.margeSecurite ?? 0) < 0 ? 'erreur' : 'bon'}
              />
            </div>

            <BlocEtat titre="Ratios d’exploitation et de structure">
              <div className="defilement-horizontal">
                <table className="etat">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 280 }}>Ratio</th>
                      {annees.map((a) => (
                        <th key={a}>{a}</th>
                      ))}
                      <th>Unité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.ratios.map((ratio) => (
                      <tr key={ratio.code}>
                        <td style={{ textAlign: 'left' }}>
                          <span className="rangee" style={{ gap: 6 }}>
                            {ratio.libelle}
                            {ratio.aide ? <InfoBulle texte={ratio.aide} /> : null}
                          </span>
                        </td>
                        {ratio.valeurs.map((v, i) => (
                          <td key={i} className={v < 0 ? 'negatif' : undefined}>
                            {ratio.unite === '%'
                              ? formaterPourcentage(v)
                              : ratio.unite === 'jours'
                                ? `${formaterMontant(v)} j`
                                : ratio.unite === 'x'
                                  ? formaterMontant(v, 2)
                                  : formaterMontant(v)}
                          </td>
                        ))}
                        <td className="discret">{ratio.unite}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlocEtat>

            <BlocEtat titre="Seuil de rentabilité">
              <Graphique
                type="barres"
                libelles={annees}
                series={[
                  { nom: 'Chiffre d’affaires', valeurs: s.map((x) => x.chiffreAffaires) },
                  { nom: 'Seuil de rentabilité', valeurs: s.map((x) => x.seuil), couleur: 'var(--alerte)' },
                  { nom: 'Seuil financier', valeurs: s.map((x) => x.seuilFinancier), couleur: 'var(--erreur)' },
                ]}
              />
              <TableauEtat entetes={['Élément', ...annees]} lignes={lignesSeuil} masquerNuls={false} />
              <div className="defilement-horizontal" style={{ marginTop: 8 }}>
                <table className="etat">
                  <thead>
                    <tr>
                      <th>Exercice</th>
                      <th>Point mort</th>
                      <th>Seuil atteint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.map((x, i) => (
                      <tr key={i}>
                        <td style={{ textAlign: 'left' }}>{annees[i]}</td>
                        <td>{x.pointMortJours} jours</td>
                        <td>
                          <span className={`badge ${x.atteint ? 'succes' : 'erreur'}`}>
                            {x.atteint ? 'Atteint' : 'Non atteint'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlocEtat>
          </>
        );
      }}
    />
  );
}

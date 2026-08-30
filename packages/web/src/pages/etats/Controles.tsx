import { formaterEuros, type Controle } from '@previs/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bandeau } from '../../ui/divers.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Section vers laquelle orienter la correction, selon le contrôle en défaut. */
const ORIENTATION: Record<string, { chemin: string; libelle: string }> = {
  bilan_equilibre: { chemin: 'etats/bilan', libelle: 'Voir le bilan' },
  bfr_bilan: { chemin: 'etats/bilan', libelle: 'Voir le besoin en fonds de roulement' },
  plan_tresorerie: { chemin: 'etats/tresorerie', libelle: 'Voir la trésorerie' },
  resultat_bilan: { chemin: 'etats/compte-resultat', libelle: 'Voir le compte de résultat' },
  amortissements_cumules: { chemin: 'investissements', libelle: 'Voir les investissements' },
  tva_periode: { chemin: 'etats/tva', libelle: 'Voir la TVA' },
  tva_annuelle: { chemin: 'etats/tva', libelle: 'Voir la TVA' },
  bilan_ouverture: { chemin: 'autres', libelle: 'Corriger le bilan d’ouverture' },
  tresorerie_negative: { chemin: 'etats/tresorerie', libelle: 'Voir la trésorerie' },
  financement_demarrage: { chemin: 'financements', libelle: 'Compléter le financement' },
  capacite_remboursement: { chemin: 'financements', libelle: 'Revoir les emprunts' },
  seuil_non_atteint: { chemin: 'recettes', libelle: 'Revoir les recettes' },
  capitaux_propres_negatifs: { chemin: 'financements', libelle: 'Renforcer les fonds propres' },
};

/** Écran des contrôles de cohérence : la pièce de confiance du dossier. */
export default function Controles() {
  const { id } = useParams<{ id: string }>();
  const [valides, setValides] = useState(false);

  return (
    <AvecResultats
      titre="Contrôles de cohérence"
      description="Les vérifications obligatoires avant transmission du dossier au client, à la banque ou au tribunal."
      enfant={(r, annees) => {
        const erreurs = r.controles.filter((c) => !c.ok && c.gravite === 'erreur');
        const avertissements = r.controles.filter((c) => !c.ok && c.gravite === 'avertissement');
        const reussis = r.controles.filter((c) => c.ok);

        const ligne = (c: Controle, ton: 'erreur' | 'alerte') => {
          const orientation = ORIENTATION[c.code];
          return (
            <div
              key={`${c.code}-${c.exercice ?? 'x'}`}
              style={{
                padding: '10px 12px',
                borderLeft: `3px solid var(--${ton === 'erreur' ? 'erreur' : 'alerte'})`,
                background: `var(--${ton === 'erreur' ? 'erreur' : 'alerte'}-fond)`,
                borderRadius: 'var(--rayon)',
                marginBottom: 8,
              }}
            >
              <div className="rangee espace" style={{ marginBottom: 3 }}>
                <strong>
                  {c.libelle}
                  {c.exercice !== undefined ? ` — ${annees[c.exercice] ?? ''}` : ''}
                </strong>
                {c.ecart !== 0 ? (
                  <span className="nombres" style={{ fontWeight: 600 }}>
                    {formaterEuros(c.ecart)}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12.5 }}>{c.message}</div>
              {orientation && id ? (
                <Link
                  to={`/dossiers/${id}/${orientation.chemin}`}
                  style={{ fontSize: 12, display: 'inline-block', marginTop: 5 }}
                >
                  {orientation.libelle} →
                </Link>
              ) : null}
            </div>
          );
        };

        return (
          <>
            {erreurs.length === 0 ? (
              <Bandeau ton="succes">
                Les {reussis.length} contrôles obligatoires sont validés. Le bilan équilibre, le
                besoin en fonds de roulement concorde avec le bilan, la trésorerie se reconstitue à
                partir du plan de financement et la TVA est cohérente. Le dossier peut être transmis.
              </Bandeau>
            ) : (
              <Bandeau ton="erreur">
                {erreurs.length} contrôle(s) en erreur. Un dossier ne doit pas être transmis dans cet
                état : l’écart n’est jamais absorbé par un compte d’attente, sa cause doit être
                corrigée à la source.
              </Bandeau>
            )}

            {erreurs.length > 0 ? (
              <BlocEtat titre={`Erreurs (${erreurs.length})`}>
                {erreurs.map((c) => ligne(c, 'erreur'))}
              </BlocEtat>
            ) : null}

            {avertissements.length > 0 ? (
              <BlocEtat
                titre={`Points de vigilance (${avertissements.length})`}
                aide="Ces points n’invalident pas le dossier mais méritent d’être expliqués au client ou au banquier."
              >
                {avertissements.map((c) => ligne(c, 'alerte'))}
              </BlocEtat>
            ) : null}

            {r.anomalies.length > 0 ? (
              <BlocEtat titre={`Anomalies de saisie (${r.anomalies.length})`}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {r.anomalies.map((a, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <span className={`badge ${a.gravite === 'erreur' ? 'erreur' : a.gravite === 'avertissement' ? 'alerte' : ''}`}>
                        {a.gravite}
                      </span>{' '}
                      {a.message}
                    </li>
                  ))}
                </ul>
              </BlocEtat>
            ) : null}

            <section className="carte">
              <header>
                <h2>Contrôles validés ({reussis.length})</h2>
                <button className="bouton discret petit" onClick={() => setValides((v) => !v)}>
                  {valides ? 'Replier' : 'Déplier'}
                </button>
              </header>
              {valides ? (
                <div className="corps">
                  <table className="etat">
                    <thead>
                      <tr>
                        <th>Contrôle</th>
                        <th>Exercice</th>
                        <th>Écart</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reussis.map((c, i) => (
                        <tr key={i}>
                          <td style={{ textAlign: 'left' }}>
                            <span className="rangee" style={{ gap: 7 }}>
                              <span className="pastille succes" />
                              {c.libelle}
                            </span>
                          </td>
                          <td style={{ textAlign: 'left' }}>
                            {c.exercice !== undefined ? annees[c.exercice] : '—'}
                          </td>
                          <td>{formaterEuros(c.ecart)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </>
        );
      }}
    />
  );
}

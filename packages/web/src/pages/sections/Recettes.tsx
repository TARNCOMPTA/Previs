import { formaterEuros, formaterPourcentage, LIBELLES_NATURE_RECETTE, type LigneRecette } from '@previs/core';
import { ChampMontant, ChampNombre, ChampTaux, ChampTexte, Interrupteur, Selecteur } from '../../ui/champs.js';
import { CarteIndicateur, Graphique, RepartitionMensuelle } from '../../ui/divers.js';
import { GrilleLignes, type Colonne } from '../../ui/grille.js';
import { AvecDossier, BlocGrille, EnTeteSection, RangeeIndicateurs } from './commun.js';

const NATURES = Object.entries(LIBELLES_NATURE_RECETTE).map(([valeur, libelle]) => ({
  valeur: valeur as LigneRecette['nature'],
  libelle,
}));

const MODES = [
  { valeur: 'montants' as const, libelle: 'Montants saisis' },
  { valeur: 'croissance' as const, libelle: 'Base et croissance' },
  { valeur: 'volume_prix' as const, libelle: 'Quantité × prix' },
  { valeur: 'capacite' as const, libelle: 'Capacité × remplissage' },
];

/** Écran de saisie du chiffre d'affaires prévisionnel. */
export default function Recettes() {
  return (
    <AvecDossier
      enfant={({ dossier, resultats, annees, modifierLigne, ajouterLigne, supprimerLigne, dupliquerLigne, deplacerLigne }) => {
        const nbExercices = annees.length;
        const maj = (id: string, champs: Record<string, unknown>) => modifierLigne('recettes.lignes', id, champs);
        const detail = new Map(resultats.recettes.detail.map((d) => [d.ligneId, d]));
        const ca = resultats.recettes.caParExercice;
        const croissance = ca.map((v, i) => (i === 0 || !ca[i - 1] ? 0 : ((v - ca[i - 1]) / ca[i - 1]) * 100));

        /** Les colonnes changent selon le mode de détermination choisi pour la ligne. */
        const colonneMontant = (i: number): Colonne<LigneRecette> => ({
          cle: `ex${i}`,
          entete: annees[i],
          largeur: 132,
          rendu: (l) => {
            if (l.mode === 'montants') {
              return (
                <ChampMontant
                  valeur={l.montants[i] ?? 0}
                  onChange={(v) => {
                    const suivants = [...l.montants];
                    suivants[i] = v;
                    maj(l.id, { montants: suivants });
                  }}
                />
              );
            }
            if (l.mode === 'croissance') {
              return i === 0 ? (
                <ChampMontant valeur={l.base} onChange={(v) => maj(l.id, { base: v })} titre="Base du premier exercice" />
              ) : (
                <ChampTaux
                  valeur={l.tauxCroissance[i] ?? 0}
                  onChange={(v) => {
                    const suivants = [...l.tauxCroissance];
                    suivants[i] = v;
                    maj(l.id, { tauxCroissance: suivants });
                  }}
                  titre="Croissance par rapport à l’exercice précédent"
                />
              );
            }
            return (
              <div className="rangee" style={{ gap: 4 }}>
                <ChampMontant
                  valeur={l.quantites[i] ?? 0}
                  onChange={(v) => {
                    const suivants = [...l.quantites];
                    suivants[i] = v;
                    maj(l.id, { quantites: suivants });
                  }}
                  titre="Quantité"
                />
                <span className="discret">×</span>
                <ChampMontant
                  valeur={l.prixUnitaire[i] ?? 0}
                  decimales={2}
                  onChange={(v) => {
                    const suivants = [...l.prixUnitaire];
                    suivants[i] = v;
                    maj(l.id, { prixUnitaire: suivants });
                  }}
                  titre="Prix unitaire"
                />
                {l.mode === 'capacite' ? (
                  <ChampTaux
                    valeur={l.tauxRemplissage[i] ?? 100}
                    onChange={(v) => {
                      const suivants = [...l.tauxRemplissage];
                      suivants[i] = v;
                      maj(l.id, { tauxRemplissage: suivants });
                    }}
                    titre="Taux de remplissage"
                  />
                ) : null}
              </div>
            );
          },
        });

        const colonnes: Array<Colonne<LigneRecette>> = [
          {
            cle: 'libelle',
            entete: 'Activité',
            largeur: 200,
            alignementGauche: true,
            rendu: (l) => <ChampTexte valeur={l.libelle} onChange={(v) => maj(l.id, { libelle: v })} />,
          },
          {
            cle: 'nature',
            entete: 'Nature',
            largeur: 190,
            alignementGauche: true,
            rendu: (l) => <Selecteur valeur={l.nature} onChange={(v) => maj(l.id, { nature: v })} options={NATURES} />,
          },
          {
            cle: 'mode',
            entete: 'Détermination',
            largeur: 170,
            alignementGauche: true,
            rendu: (l) => <Selecteur valeur={l.mode} onChange={(v) => maj(l.id, { mode: v })} options={MODES} />,
          },
          ...annees.map((_, i) => colonneMontant(i)),
          ...annees.map((annee, i) => ({
            cle: `ca${i}`,
            entete: `CA ${annee}`,
            largeur: 106,
            rendu: (l: LigneRecette) => (
              <span className="discret nombres">{formaterEuros(detail.get(l.id)?.montants[i] ?? 0)}</span>
            ),
            total: (l: LigneRecette) => detail.get(l.id)?.montants[i] ?? 0,
          })),
        ];

        const caMensuel = resultats.recettes.caMensuel;

        return (
          <div className="pile">
            <EnTeteSection
              titre="Recettes"
              description="Le chiffre d’affaires par activité, selon le mode de détermination le plus proche de la réalité du client."
              synthese={
                <>
                  <RangeeIndicateurs>
                    {annees.map((annee, i) => (
                      <CarteIndicateur
                        key={annee}
                        valeur={formaterEuros(ca[i] ?? 0)}
                        libelle={`Chiffre d’affaires ${annee}`}
                        detail={i > 0 ? `${croissance[i] >= 0 ? '+' : ''}${formaterPourcentage(croissance[i])}` : undefined}
                      />
                    ))}
                  </RangeeIndicateurs>

                  <section className="carte">
                    <div className="corps">
                      <h3 style={{ marginBottom: 8 }}>Chiffre d’affaires mensuel</h3>
                      <Graphique
                        type="courbe"
                        libelles={resultats.libellesMois}
                        series={[{ nom: 'Chiffre d’affaires', valeurs: caMensuel }]}
                        hauteur={150}
                      />
                      <div className="aide-champ">
                        La forme de la courbe reflète les clés de répartition saisies : c’est la
                        saisonnalité qui alimentera la trésorerie mensuelle.
                      </div>
                    </div>
                  </section>
                </>
              }
            />

            <BlocGrille
              titre="Les activités"
              aide="Les colonnes de saisie s’adaptent au mode choisi. La colonne « CA » affiche toujours le chiffre d’affaires qui en résulte."
            >
              <GrilleLignes
                colonnes={colonnes}
                lignes={dossier.recettes.lignes}
                cle={(l) => l.id}
                estProposee={(l) => l.origine === 'llm'}
                onSupprimer={(l) => supprimerLigne('recettes.lignes', l.id)}
                onDupliquer={(l) => dupliquerLigne('recettes.lignes', l.id)}
                onDeplacer={(l, sens) => deplacerLigne('recettes.lignes', l.id, sens)}
                messageVide="Aucune activité saisie. Sans chiffre d’affaires, tous les états restent à zéro."
                libelleTotal="Total du chiffre d’affaires"
                detail={(l) => (
                  <div className="pile">
                    <div className="grille-champs">
                      <ChampTaux libelle="Taux de TVA" valeur={l.tauxTva} onChange={(v) => maj(l.id, { tauxTva: v })} />
                      <ChampNombre
                        libelle="Délai d’encaissement (jours)"
                        valeur={l.delaiEncaissementJours ?? dossier.parametres.bfr.delaiClientsJours}
                        min={0}
                        max={365}
                        onChange={(v) => maj(l.id, { delaiEncaissementJours: v })}
                      />
                      <ChampTaux
                        libelle="Achats liés (% du CA)"
                        valeur={l.tauxAchatsLiesPourcent}
                        onChange={(v) => maj(l.id, { tauxAchatsLiesPourcent: v })}
                        aide="Génère automatiquement un achat consommé variable, pour le négoce ou la restauration."
                      />
                      {l.mode === 'volume_prix' || l.mode === 'capacite' ? (
                        <ChampTexte
                          libelle="Unité"
                          valeur={l.unite}
                          onChange={(v) => maj(l.id, { unite: v })}
                          placeholder="couverts, séances, heures…"
                        />
                      ) : null}
                      <ChampTexte
                        libelle="Note"
                        valeur={l.note ?? ''}
                        onChange={(v) => maj(l.id, { note: v || undefined })}
                      />
                      <Interrupteur libelle="Ligne active" valeur={l.actif} onChange={(v) => maj(l.id, { actif: v })} />
                    </div>
                    <RepartitionMensuelle
                      valeur={l.repartition}
                      onChange={(v) => maj(l.id, { repartition: v })}
                      nbExercices={nbExercices}
                    />
                  </div>
                )}
                actions={
                  <>
                    <button
                      className="bouton"
                      onClick={() =>
                        ajouterLigne('recettes.lignes', {
                          libelle: 'Nouvelle activité',
                          nature: dossier.identite.regime === 'BNC' ? 'honoraires' : 'prestations',
                          tauxTva: dossier.parametres.tva.tauxParDefaut,
                          montants: [],
                        })
                      }
                    >
                      + Activité
                    </button>
                    <button
                      className="bouton"
                      onClick={() =>
                        ajouterLigne('recettes.lignes', {
                          libelle: 'Subvention d’exploitation',
                          nature: 'subvention_exploitation',
                          tauxTva: 0,
                          montants: [],
                        })
                      }
                    >
                      + Subvention d’exploitation
                    </button>
                  </>
                }
              />
            </BlocGrille>

            {dossier.recettes.lignes.filter((l) => l.actif).length > 1 ? (
              <section className="carte">
                <header>
                  <h2>Répartition par activité</h2>
                </header>
                <div className="corps">
                  <Graphique type="barres" libelles={annees} series={seriesParActivite(resultats)} />
                </div>
              </section>
            ) : null}
          </div>
        );
      }}
    />
  );
}

/** Nombre d'activités détaillées dans le graphique ; au-delà, elles sont regroupées. */
const ACTIVITES_DETAILLEES = 8;

/**
 * Séries du graphique de répartition.
 *
 * Un dossier peut compter des dizaines d'activités : au-delà de huit, les barres
 * deviendraient illisibles. Les plus importantes sont détaillées, les autres cumulées.
 */
function seriesParActivite(resultats: {
  recettes: { detail: Array<{ libelle: string; montants: number[] }> };
}): Array<{ nom: string; valeurs: number[] }> {
  const detail = [...resultats.recettes.detail].sort(
    (a, b) => b.montants.reduce((t, v) => t + v, 0) - a.montants.reduce((t, v) => t + v, 0),
  );
  if (detail.length <= ACTIVITES_DETAILLEES) {
    return detail.map((d) => ({ nom: d.libelle, valeurs: d.montants }));
  }

  const principales = detail.slice(0, ACTIVITES_DETAILLEES);
  const reste = detail.slice(ACTIVITES_DETAILLEES);
  const cumul = reste[0].montants.map((_, i) => reste.reduce((t, d) => t + (d.montants[i] ?? 0), 0));
  return [
    ...principales.map((d) => ({ nom: d.libelle, valeurs: d.montants })),
    { nom: `${reste.length} autres activités`, valeurs: cumul },
  ];
}

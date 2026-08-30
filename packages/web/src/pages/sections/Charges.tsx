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
import { AvecDossier, BlocGrille, EnTeteSection, RangeeIndicateurs } from './commun.js';

const CATEGORIES = Object.entries(LIBELLES_CATEGORIE_CHARGE).map(([valeur, libelle]) => ({
  valeur: valeur as LigneCharge['categorie'],
  libelle,
}));

const STATUTS = Object.entries(LIBELLES_STATUT_PERSONNEL).map(([valeur, libelle]) => ({
  valeur: valeur as LignePersonnel['statut'],
  libelle,
}));

/** Écran de saisie des charges d'exploitation et du personnel. */
export default function Charges() {
  return (
    <AvecDossier
      enfant={({ dossier, resultats, annees, modifierLigne, ajouterLigne, supprimerLigne, dupliquerLigne, deplacerLigne }) => {
        const nbExercices = annees.length;
        const majCharge = (id: string, champs: Record<string, unknown>) =>
          modifierLigne('charges.lignes', id, champs);
        const majPersonnel = (id: string, champs: Record<string, unknown>) =>
          modifierLigne('charges.personnel', id, champs);

        const detailPersonnel = new Map(resultats.charges.personnel.map((p) => [p.ligneId, p]));
        const dernier = nbExercices - 1;
        const masseSalariale = resultats.compteResultat.map((c) => c.salairesBruts + c.chargesSociales);
        const aUnExploitant = dossier.charges.personnel.some((p) => p.actif && p.statut === 'exploitant');

        const colonnesCharges: Array<Colonne<LigneCharge>> = [
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
            total: (l: LigneCharge) =>
              resultats.charges.detail.find((d) => d.ligneId === l.id)?.montants[i] ?? 0,
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
        ];

        const colonnesPersonnel: Array<Colonne<LignePersonnel>> = [
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
              rendu: (p: LignePersonnel) => {
                const d = detailPersonnel.get(p.id);
                const cout = (d?.brut[i] ?? 0) + (d?.charges[i] ?? 0);
                return <span className="discret nombres">{formaterEuros(cout)}</span>;
              },
              total: (p: LignePersonnel) => {
                const d = detailPersonnel.get(p.id);
                return (d?.brut[i] ?? 0) + (d?.charges[i] ?? 0);
              },
            },
          ]),
        ];

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
                lignes={dossier.charges.lignes}
                cle={(l) => l.id}
                estProposee={(l) => l.origine === 'llm'}
                onSupprimer={(l) => supprimerLigne('charges.lignes', l.id)}
                onDupliquer={(l) => dupliquerLigne('charges.lignes', l.id)}
                onDeplacer={(l, sens) => deplacerLigne('charges.lignes', l.id, sens)}
                messageVide="Aucune charge saisie."
                libelleTotal="Total des charges externes"
                detail={(l) => (
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
                )}
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
                  lignes={dossier.charges.personnel}
                  cle={(p) => p.id}
                  estProposee={(p) => p.origine === 'llm'}
                  onSupprimer={(p) => supprimerLigne('charges.personnel', p.id)}
                  onDupliquer={(p) => dupliquerLigne('charges.personnel', p.id)}
                  messageVide="Aucun poste de personnel saisi."
                  libelleTotal="Masse salariale chargée"
                  detail={(p) => (
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
                  )}
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
      }}
    />
  );
}

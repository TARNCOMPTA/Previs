import {
  LIBELLES_REGIME,
  LIBELLES_TYPE_DOSSIER,
  formaterEuros,
  type Dirigeant,
  type LigneDistribution,
  type LigneExceptionnelle,
  type LignePassifDeclare,
  type RegimeFiscal,
} from '@previs/core';
import { useState } from 'react';
import {
  ChampDate,
  ChampMontant,
  ChampNombre,
  ChampTaux,
  ChampTexte,
  ChampZoneTexte,
  Interrupteur,
  Selecteur,
} from '../../ui/champs.js';
import { Bandeau, RepartitionMensuelle } from '../../ui/divers.js';
import { GrilleLignes, type Colonne } from '../../ui/grille.js';
import { AvecDossier, BlocGrille, EnTeteSection } from './commun.js';

type Onglet = 'hypotheses' | 'identite' | 'divers';

/** Section « Autres » : hypothèses, identité et introduction, éléments divers. */
export default function Autres() {
  const [onglet, setOnglet] = useState<Onglet>('hypotheses');

  return (
    <AvecDossier
      enfant={({ dossier, resultats, annees, modifier, modifierLigne, ajouterLigne, supprimerLigne }) => {
        const p = dossier.parametres;
        const identite = dossier.identite;
        const societe = identite.regime === 'IS';
        const nbExercices = annees.length;

        const definir = (transformation: (d: typeof dossier) => void) => modifier(transformation);

        const onglets: Array<{ cle: Onglet; libelle: string }> = [
          { cle: 'hypotheses', libelle: 'Hypothèses et paramètres' },
          { cle: 'identite', libelle: 'Identité et introduction' },
          { cle: 'divers', libelle: 'Éléments exceptionnels et divers' },
        ];

        return (
          <div className="pile">
            <EnTeteSection
              titre="Autres"
              description="Les hypothèses qui pilotent le moteur, l’identité du dossier, et les éléments qui ne relèvent d’aucune autre section."
            />

            <div className="rangee" style={{ gap: 4, borderBottom: '1px solid var(--trait)' }}>
              {onglets.map((o) => (
                <button
                  key={o.cle}
                  className="bouton discret"
                  onClick={() => setOnglet(o.cle)}
                  style={{
                    borderRadius: 0,
                    borderBottom: `2px solid ${onglet === o.cle ? 'var(--bleu)' : 'transparent'}`,
                    color: onglet === o.cle ? 'var(--bleu)' : undefined,
                    fontWeight: onglet === o.cle ? 600 : 400,
                  }}
                >
                  {o.libelle}
                </button>
              ))}
            </div>

            {onglet === 'hypotheses' ? (
              <>
                <BlocGrille titre="Période couverte">
                  <div className="grille-champs">
                    <ChampDate
                      libelle="Premier jour du premier exercice"
                      valeur={p.dateDebut}
                      onChange={(v) => definir((d) => void (d.parametres.dateDebut = v))}
                    />
                    <ChampNombre
                      libelle="Nombre d’exercices"
                      valeur={p.nbExercices}
                      min={1}
                      max={10}
                      onChange={(v) => definir((d) => void (d.parametres.nbExercices = v))}
                      aide="Jusqu’à dix pour un plan de continuation."
                    />
                    <ChampNombre
                      libelle="Durée du premier exercice (mois)"
                      valeur={p.dureePremierExerciceMois}
                      min={1}
                      max={24}
                      onChange={(v) => definir((d) => void (d.parametres.dureePremierExerciceMois = v))}
                      aide="12 par défaut ; jusqu’à 24 pour un premier exercice long."
                    />
                    <ChampMontant
                      libelle="Trésorerie au premier jour"
                      valeur={p.tresorerieInitiale}
                      onChange={(v) => definir((d) => void (d.parametres.tresorerieInitiale = v))}
                      aide="Sans bilan d’ouverture, elle est portée en report à nouveau."
                    />
                  </div>
                </BlocGrille>

                <BlocGrille titre="Taxe sur la valeur ajoutée">
                  <div className="grille-champs">
                    <Interrupteur
                      libelle="Assujetti à la TVA"
                      valeur={p.tva.assujetti}
                      onChange={(v) => definir((d) => void (d.parametres.tva.assujetti = v))}
                    />
                    <Selecteur
                      libelle="Régime de déclaration"
                      valeur={p.tva.regime}
                      onChange={(v) => definir((d) => void (d.parametres.tva.regime = v))}
                      options={[
                        { valeur: 'mensuel' as const, libelle: 'Mensuel' },
                        { valeur: 'trimestriel' as const, libelle: 'Trimestriel' },
                        { valeur: 'annuel' as const, libelle: 'Annuel' },
                        { valeur: 'franchise' as const, libelle: 'Franchise en base' },
                      ]}
                      desactive={!p.tva.assujetti}
                    />
                    <ChampTaux
                      libelle="Taux de TVA par défaut"
                      valeur={p.tva.tauxParDefaut}
                      onChange={(v) => definir((d) => void (d.parametres.tva.tauxParDefaut = v))}
                      desactive={!p.tva.assujetti}
                    />
                    <ChampNombre
                      libelle="Décalage de décaissement (mois)"
                      valeur={p.tva.decalageDecaissementMois}
                      min={0}
                      max={6}
                      onChange={(v) => definir((d) => void (d.parametres.tva.decalageDecaissementMois = v))}
                      desactive={!p.tva.assujetti}
                    />
                    <Interrupteur
                      libelle="Crédit de TVA reporté"
                      valeur={p.tva.creditReportable}
                      onChange={(v) => definir((d) => void (d.parametres.tva.creditReportable = v))}
                      aide="Décocher pour demander le remboursement du crédit."
                      desactive={!p.tva.assujetti}
                    />
                  </div>
                  {!p.tva.assujetti ? (
                    <Bandeau>
                      Le dossier n’étant pas assujetti, les montants saisis sont considérés comme
                      définitifs : ils constituent la charge ou le produit en totalité.
                    </Bandeau>
                  ) : null}
                </BlocGrille>

                {societe ? (
                  <BlocGrille titre="Impôt sur les sociétés">
                    <div className="grille-champs">
                      <Interrupteur
                        libelle="Éligible au taux réduit"
                        valeur={p.is.eligibleTauxReduit}
                        onChange={(v) => definir((d) => void (d.parametres.is.eligibleTauxReduit = v))}
                      />
                      <ChampTaux
                        libelle="Taux réduit"
                        valeur={p.is.tauxReduit}
                        onChange={(v) => definir((d) => void (d.parametres.is.tauxReduit = v))}
                      />
                      <ChampMontant
                        libelle="Plafond du taux réduit"
                        valeur={p.is.plafondTauxReduit}
                        onChange={(v) => definir((d) => void (d.parametres.is.plafondTauxReduit = v))}
                      />
                      <ChampTaux
                        libelle="Taux normal"
                        valeur={p.is.tauxNormal}
                        onChange={(v) => definir((d) => void (d.parametres.is.tauxNormal = v))}
                      />
                      <ChampNombre
                        libelle="Paiement du solde (mois après clôture)"
                        valeur={p.is.decalagePaiementMois}
                        min={0}
                        max={12}
                        onChange={(v) => definir((d) => void (d.parametres.is.decalagePaiementMois = v))}
                      />
                      <Interrupteur
                        libelle="Acomptes trimestriels"
                        valeur={p.is.acomptes}
                        onChange={(v) => definir((d) => void (d.parametres.is.acomptes = v))}
                      />
                    </div>
                  </BlocGrille>
                ) : (
                  <BlocGrille
                    titre="Impôt sur le revenu"
                    aide="L’impôt sur le revenu est personnel : il n’est jamais une charge de l’entreprise."
                  >
                    <div className="grille-champs">
                      <ChampTaux
                        libelle="Taux moyen d’imposition estimé"
                        valeur={p.ir.tauxMoyen}
                        onChange={(v) => definir((d) => void (d.parametres.ir.tauxMoyen = v))}
                        aide="Sert uniquement à une information de synthèse."
                      />
                      <Interrupteur
                        libelle="Décaisser l’impôt estimé"
                        valeur={p.ir.decaisse}
                        onChange={(v) => definir((d) => void (d.parametres.ir.decaisse = v))}
                        aide="Le prélèvement à la source vient alors diminuer le compte de l’exploitant."
                      />
                    </div>
                  </BlocGrille>
                )}

                <BlocGrille titre="Cotisations sociales">
                  <div className="grille-champs">
                    <ChampTaux
                      libelle="Charges patronales"
                      valeur={p.social.tauxChargesPatronales}
                      onChange={(v) => definir((d) => void (d.parametres.social.tauxChargesPatronales = v))}
                    />
                    <ChampTaux
                      libelle="Charges salariales"
                      valeur={p.social.tauxChargesSalariales}
                      onChange={(v) => definir((d) => void (d.parametres.social.tauxChargesSalariales = v))}
                    />
                    <ChampNombre
                      libelle="Décalage de règlement (mois)"
                      valeur={p.social.decalageMois}
                      min={0}
                      max={6}
                      onChange={(v) => definir((d) => void (d.parametres.social.decalageMois = v))}
                    />
                    <ChampTaux
                      libelle="Cotisations du travailleur non salarié"
                      valeur={p.tns.tauxCotisations}
                      onChange={(v) => definir((d) => void (d.parametres.tns.tauxCotisations = v))}
                    />
                    <ChampMontant
                      libelle="Cotisations minimales"
                      valeur={p.tns.cotisationsMinimales}
                      onChange={(v) => definir((d) => void (d.parametres.tns.cotisationsMinimales = v))}
                    />
                    <Selecteur
                      libelle="Périodicité des cotisations TNS"
                      valeur={p.tns.periodicite}
                      onChange={(v) => definir((d) => void (d.parametres.tns.periodicite = v))}
                      options={[
                        { valeur: 'mensuelle' as const, libelle: 'Mensuelle' },
                        { valeur: 'trimestrielle' as const, libelle: 'Trimestrielle' },
                      ]}
                    />
                  </div>
                </BlocGrille>

                <BlocGrille
                  titre="Besoin en fonds de roulement"
                  aide="Ces délais pilotent à la fois le bilan et la trésorerie mensuelle."
                >
                  <div className="grille-champs">
                    <ChampNombre
                      libelle="Délai de règlement clients (jours)"
                      valeur={p.bfr.delaiClientsJours}
                      min={0}
                      max={365}
                      onChange={(v) => definir((d) => void (d.parametres.bfr.delaiClientsJours = v))}
                    />
                    <ChampTaux
                      libelle="Part encaissée comptant"
                      valeur={p.bfr.partComptantPourcent}
                      onChange={(v) => definir((d) => void (d.parametres.bfr.partComptantPourcent = v))}
                    />
                    <ChampNombre
                      libelle="Délai fournisseurs (jours)"
                      valeur={p.bfr.delaiFournisseursJours}
                      min={0}
                      max={365}
                      onChange={(v) => definir((d) => void (d.parametres.bfr.delaiFournisseursJours = v))}
                    />
                    <ChampNombre
                      libelle="Rotation du stock (jours)"
                      valeur={p.bfr.rotationStockJours}
                      min={0}
                      max={365}
                      onChange={(v) => definir((d) => void (d.parametres.bfr.rotationStockJours = v))}
                      aide="0 s’il n’y a pas de stock."
                    />
                  </div>
                </BlocGrille>

                <BlocGrille titre="Impôts locaux et distribution">
                  <div className="grille-champs">
                    {annees.map((annee, i) => (
                      <ChampMontant
                        key={annee}
                        libelle={`Cotisation foncière ${annee}`}
                        valeur={p.cfe[i] ?? 0}
                        onChange={(v) =>
                          definir((d) => {
                            const suivants = [...d.parametres.cfe];
                            suivants[i] = v;
                            d.parametres.cfe = suivants;
                          })
                        }
                      />
                    ))}
                    {societe ? (
                      <>
                        <ChampTaux
                          libelle="Réserve légale (% du bénéfice)"
                          valeur={p.reserveLegalePourcent}
                          onChange={(v) => definir((d) => void (d.parametres.reserveLegalePourcent = v))}
                        />
                        <ChampTaux
                          libelle="Plafond de la réserve légale (% du capital)"
                          valeur={p.plafondReserveLegalePourcent}
                          onChange={(v) => definir((d) => void (d.parametres.plafondReserveLegalePourcent = v))}
                        />
                      </>
                    ) : null}
                    <ChampTaux
                      libelle="Intérêts servis sur comptes courants"
                      valeur={p.tauxInteretCompteCourant}
                      onChange={(v) => definir((d) => void (d.parametres.tauxInteretCompteCourant = v))}
                    />
                  </div>
                </BlocGrille>
              </>
            ) : null}

            {onglet === 'identite' ? (
              <>
                <BlocGrille titre="Identité du client">
                  <div className="grille-champs">
                    <ChampTexte
                      libelle="Raison sociale"
                      valeur={identite.raisonSociale}
                      onChange={(v) => definir((d) => void (d.identite.raisonSociale = v))}
                    />
                    <ChampTexte
                      libelle="Forme juridique"
                      valeur={identite.formeJuridique}
                      onChange={(v) => definir((d) => void (d.identite.formeJuridique = v))}
                      placeholder="SAS, SARL, entreprise individuelle…"
                    />
                    <Selecteur
                      libelle="Régime fiscal"
                      valeur={identite.regime}
                      onChange={(v: RegimeFiscal) => definir((d) => void (d.identite.regime = v))}
                      options={Object.entries(LIBELLES_REGIME).map(([valeur, libelle]) => ({
                        valeur: valeur as RegimeFiscal,
                        libelle,
                      }))}
                      aide="Le régime pilote tout le moteur de calcul."
                    />
                    <Selecteur
                      libelle="Type de dossier"
                      valeur={identite.typeDossier}
                      onChange={(v) => definir((d) => void (d.identite.typeDossier = v))}
                      options={Object.entries(LIBELLES_TYPE_DOSSIER).map(([valeur, libelle]) => ({
                        valeur: valeur as typeof identite.typeDossier,
                        libelle,
                      }))}
                    />
                    <ChampTexte
                      libelle="Activité"
                      valeur={identite.activite}
                      onChange={(v) => definir((d) => void (d.identite.activite = v))}
                    />
                    <ChampTexte
                      libelle="Code NAF"
                      valeur={identite.codeNaf}
                      onChange={(v) => definir((d) => void (d.identite.codeNaf = v))}
                    />
                    <ChampTexte
                      libelle="SIRET"
                      valeur={identite.siret}
                      onChange={(v) => definir((d) => void (d.identite.siret = v))}
                    />
                    <ChampTexte
                      libelle="Adresse"
                      valeur={identite.adresse.voie}
                      onChange={(v) => definir((d) => void (d.identite.adresse.voie = v))}
                    />
                    <ChampTexte
                      libelle="Code postal"
                      valeur={identite.adresse.codePostal}
                      onChange={(v) => definir((d) => void (d.identite.adresse.codePostal = v))}
                    />
                    <ChampTexte
                      libelle="Ville"
                      valeur={identite.adresse.ville}
                      onChange={(v) => definir((d) => void (d.identite.adresse.ville = v))}
                    />
                    <ChampTexte
                      libelle="Adresse électronique"
                      valeur={identite.email}
                      onChange={(v) => definir((d) => void (d.identite.email = v))}
                    />
                    <ChampTexte
                      libelle="Téléphone"
                      valeur={identite.telephone}
                      onChange={(v) => definir((d) => void (d.identite.telephone = v))}
                    />
                  </div>
                </BlocGrille>

                <BlocGrille titre="Dirigeants et associés">
                  <GrilleLignes<Dirigeant>
                    colonnes={[
                      {
                        cle: 'nom',
                        entete: 'Nom',
                        largeur: 240,
                        alignementGauche: true,
                        rendu: (x) => (
                          <ChampTexte
                            valeur={x.nom}
                            onChange={(v) =>
                              definir((d) => {
                                const cible = d.identite.dirigeants.find((y) => y.id === x.id);
                                if (cible) cible.nom = v;
                              })
                            }
                          />
                        ),
                      },
                      {
                        cle: 'fonction',
                        entete: 'Fonction',
                        largeur: 200,
                        alignementGauche: true,
                        rendu: (x) => (
                          <ChampTexte
                            valeur={x.fonction}
                            onChange={(v) =>
                              definir((d) => {
                                const cible = d.identite.dirigeants.find((y) => y.id === x.id);
                                if (cible) cible.fonction = v;
                              })
                            }
                          />
                        ),
                      },
                      {
                        cle: 'part',
                        entete: 'Part du capital',
                        largeur: 120,
                        rendu: (x) => (
                          <ChampTaux
                            valeur={x.partCapital}
                            onChange={(v) =>
                              definir((d) => {
                                const cible = d.identite.dirigeants.find((y) => y.id === x.id);
                                if (cible) cible.partCapital = v;
                              })
                            }
                          />
                        ),
                      },
                    ]}
                    lignes={identite.dirigeants}
                    cle={(x) => x.id}
                    onSupprimer={(x) =>
                      definir((d) => {
                        d.identite.dirigeants = d.identite.dirigeants.filter((y) => y.id !== x.id);
                      })
                    }
                    messageVide="Aucun dirigeant renseigné."
                    actions={
                      <button
                        className="bouton"
                        onClick={() =>
                          definir((d) => {
                            d.identite.dirigeants.push({
                              id: `dir_${d.identite.dirigeants.length + 1}_${Date.now().toString(36)}`,
                              nom: '',
                              fonction: 'Gérant',
                              partCapital: 0,
                            });
                          })
                        }
                      >
                        + Dirigeant
                      </button>
                    }
                  />
                </BlocGrille>

                <BlocGrille
                  titre="Introduction du rapport"
                  aide="Quatre à six paragraphes, repris tels quels dans le PDF. Séparer les paragraphes par une ligne vide."
                >
                  <ChampZoneTexte
                    valeur={identite.introduction}
                    onChange={(v) => definir((d) => void (d.identite.introduction = v))}
                    lignes={12}
                    compteur
                    placeholder="M. X envisage la création…"
                  />
                </BlocGrille>

                {identite.typeDossier === 'plan_continuation' ? (
                  <>
                    <BlocGrille titre="Rappel de la procédure">
                      <ChampZoneTexte
                        valeur={identite.rappelProcedure}
                        onChange={(v) => definir((d) => void (d.identite.rappelProcedure = v))}
                        lignes={8}
                        placeholder="Date du jugement d’ouverture, période d’observation…"
                      />
                    </BlocGrille>

                    <BlocGrille titre="Passif déclaré et échéancier">
                      <GrilleLignes<LignePassifDeclare>
                        colonnes={[
                          {
                            cle: 'creancier',
                            entete: 'Créancier',
                            largeur: 220,
                            alignementGauche: true,
                            rendu: (x) => (
                              <ChampTexte
                                valeur={x.creancier}
                                onChange={(v) => modifierLigne('autres.passifDeclare', x.id, { creancier: v })}
                              />
                            ),
                          },
                          {
                            cle: 'nature',
                            entete: 'Nature',
                            largeur: 190,
                            alignementGauche: true,
                            rendu: (x) => (
                              <Selecteur
                                valeur={x.nature}
                                onChange={(v) => modifierLigne('autres.passifDeclare', x.id, { nature: v })}
                                options={[
                                  { valeur: 'privilegie' as const, libelle: 'Privilégié' },
                                  { valeur: 'chirographaire' as const, libelle: 'Chirographaire' },
                                  { valeur: 'fiscal_social' as const, libelle: 'Fiscal et social' },
                                  { valeur: 'bancaire' as const, libelle: 'Bancaire' },
                                ]}
                              />
                            ),
                          },
                          {
                            cle: 'montant',
                            entete: 'Montant déclaré',
                            largeur: 130,
                            rendu: (x) => (
                              <ChampMontant
                                valeur={x.montantDeclare}
                                onChange={(v) => modifierLigne('autres.passifDeclare', x.id, { montantDeclare: v })}
                              />
                            ),
                            total: (x) => x.montantDeclare,
                          },
                          ...annees.map((annee, i) => ({
                            cle: `ech${i}`,
                            entete: `Échéance ${annee}`,
                            largeur: 116,
                            rendu: (x: LignePassifDeclare) => (
                              <ChampMontant
                                valeur={x.echeances.find((e) => e.exercice === i)?.montant ?? 0}
                                onChange={(v) => {
                                  const suivantes = x.echeances.filter((e) => e.exercice !== i);
                                  if (v !== 0) suivantes.push({ exercice: i, mois: 12, montant: v });
                                  modifierLigne('autres.passifDeclare', x.id, { echeances: suivantes });
                                }}
                              />
                            ),
                            total: (x: LignePassifDeclare) =>
                              x.echeances.find((e) => e.exercice === i)?.montant ?? 0,
                          })),
                        ]}
                        lignes={dossier.autres.passifDeclare}
                        cle={(x) => x.id}
                        onSupprimer={(x) => supprimerLigne('autres.passifDeclare', x.id)}
                        messageVide="Aucune créance déclarée."
                        libelleTotal="Total du passif déclaré"
                        actions={
                          <button
                            className="bouton"
                            onClick={() => ajouterLigne('autres.passifDeclare', { libelle: 'Créance', creancier: '' })}
                          >
                            + Créance déclarée
                          </button>
                        }
                      />
                    </BlocGrille>
                  </>
                ) : null}
              </>
            ) : null}

            {onglet === 'divers' ? (
              <>
                <BlocGrille
                  titre="Produits et charges exceptionnels"
                  aide="Hors exploitation courante : indemnités, pénalités, cessions non immobilisées."
                >
                  <GrilleLignes<LigneExceptionnelle>
                    colonnes={[
                      {
                        cle: 'libelle',
                        entete: 'Libellé',
                        largeur: 220,
                        alignementGauche: true,
                        rendu: (x) => (
                          <ChampTexte
                            valeur={x.libelle}
                            onChange={(v) => modifierLigne('autres.exceptionnels', x.id, { libelle: v })}
                          />
                        ),
                      },
                      {
                        cle: 'sens',
                        entete: 'Sens',
                        largeur: 130,
                        alignementGauche: true,
                        rendu: (x) => (
                          <Selecteur
                            valeur={x.sens}
                            onChange={(v) => modifierLigne('autres.exceptionnels', x.id, { sens: v })}
                            options={[
                              { valeur: 'produit' as const, libelle: 'Produit' },
                              { valeur: 'charge' as const, libelle: 'Charge' },
                            ]}
                          />
                        ),
                      },
                      ...annees.map((annee, i) => ({
                        cle: `ex${i}`,
                        entete: annee,
                        largeur: 116,
                        rendu: (x: LigneExceptionnelle) => (
                          <ChampMontant
                            valeur={x.montants[i] ?? 0}
                            onChange={(v) => {
                              const suivants = [...x.montants];
                              suivants[i] = v;
                              modifierLigne('autres.exceptionnels', x.id, { montants: suivants });
                            }}
                          />
                        ),
                        total: (x: LigneExceptionnelle) => (x.sens === 'produit' ? 1 : -1) * (x.montants[i] ?? 0),
                      })),
                    ]}
                    lignes={dossier.autres.exceptionnels}
                    cle={(x) => x.id}
                    estProposee={(x) => x.origine === 'llm'}
                    onSupprimer={(x) => supprimerLigne('autres.exceptionnels', x.id)}
                    messageVide="Aucun élément exceptionnel."
                    libelleTotal="Solde exceptionnel"
                    detail={(x) => (
                      <div className="pile">
                        <div className="grille-champs">
                          <ChampTaux
                            libelle="Taux de TVA"
                            valeur={x.tauxTva}
                            onChange={(v) => modifierLigne('autres.exceptionnels', x.id, { tauxTva: v })}
                          />
                          <Interrupteur
                            libelle="Mouvement de trésorerie"
                            valeur={x.impacteTresorerie}
                            onChange={(v) => modifierLigne('autres.exceptionnels', x.id, { impacteTresorerie: v })}
                            aide="Décocher pour une écriture sans flux, comme une reprise de provision."
                          />
                        </div>
                        <RepartitionMensuelle
                          valeur={x.repartition}
                          onChange={(v) => modifierLigne('autres.exceptionnels', x.id, { repartition: v })}
                          nbExercices={nbExercices}
                        />
                      </div>
                    )}
                    actions={
                      <button
                        className="bouton"
                        onClick={() => ajouterLigne('autres.exceptionnels', { libelle: 'Élément exceptionnel' })}
                      >
                        + Élément exceptionnel
                      </button>
                    }
                  />
                </BlocGrille>

                <BlocGrille
                  titre={societe ? 'Dividendes' : 'Prélèvements de l’exploitant'}
                  aide={
                    societe
                      ? 'Les dividendes sont prélevés sur le résultat distribuable et diminuent le report à nouveau.'
                      : 'Les prélèvements ne sont pas déductibles : ils diminuent le compte de l’exploitant.'
                  }
                >
                  <GrilleLignes<LigneDistribution>
                    colonnes={[
                      {
                        cle: 'libelle',
                        entete: 'Libellé',
                        largeur: 220,
                        alignementGauche: true,
                        rendu: (x) => (
                          <ChampTexte
                            valeur={x.libelle}
                            onChange={(v) => modifierLigne('autres.distributions', x.id, { libelle: v })}
                          />
                        ),
                      },
                      ...annees.map((annee, i) => ({
                        cle: `ex${i}`,
                        entete: annee,
                        largeur: 116,
                        rendu: (x: LigneDistribution) => (
                          <ChampMontant
                            valeur={x.montants[i] ?? 0}
                            onChange={(v) => {
                              const suivants = [...x.montants];
                              suivants[i] = v;
                              modifierLigne('autres.distributions', x.id, { montants: suivants });
                            }}
                          />
                        ),
                        total: (x: LigneDistribution) => x.montants[i] ?? 0,
                      })),
                    ]}
                    lignes={dossier.autres.distributions}
                    cle={(x) => x.id}
                    estProposee={(x) => x.origine === 'llm'}
                    onSupprimer={(x) => supprimerLigne('autres.distributions', x.id)}
                    messageVide="Aucune distribution prévue."
                    libelleTotal="Total distribué"
                    actions={
                      <button
                        className="bouton"
                        onClick={() =>
                          ajouterLigne('autres.distributions', {
                            libelle: societe ? 'Dividendes' : 'Prélèvements',
                            type: societe ? 'dividendes' : 'prelevements_exploitant',
                          })
                        }
                      >
                        + {societe ? 'Dividendes' : 'Prélèvements'}
                      </button>
                    }
                  />
                </BlocGrille>

                <BlocGrille
                  titre="Bilan d’ouverture"
                  aide="À renseigner pour une reprise, un plan de continuation ou un prévisionnel adossé à une situation existante."
                >
                  <div className="pile">
                    <Interrupteur
                      libelle="Le dossier reprend un bilan d’ouverture"
                      valeur={dossier.autres.bilanOuverture.actif}
                      onChange={(v) => definir((d) => void (d.autres.bilanOuverture.actif = v))}
                    />
                    {dossier.autres.bilanOuverture.actif ? (
                      <>
                        <div className="grille-champs">
                          {(
                            [
                              ['immobilisationsBrutes', 'Immobilisations brutes'],
                              ['amortissementsCumules', 'Amortissements cumulés'],
                              ['stocks', 'Stocks'],
                              ['creancesClients', 'Créances clients'],
                              ['autresCreances', 'Autres créances'],
                              ['capitalSocial', societe ? 'Capital social' : 'Compte de l’exploitant'],
                              ['reserves', 'Réserves'],
                              ['reportANouveau', 'Report à nouveau'],
                              ['comptesCourants', 'Comptes courants'],
                              ['empruntsRestantDus', 'Emprunts restant dus'],
                              ['dettesFournisseurs', 'Dettes fournisseurs'],
                              ['dettesFiscalesSociales', 'Dettes fiscales et sociales'],
                            ] as const
                          ).map(([cle, libelle]) => (
                            <ChampMontant
                              key={cle}
                              libelle={libelle}
                              valeur={dossier.autres.bilanOuverture[cle]}
                              onChange={(v) => definir((d) => void (d.autres.bilanOuverture[cle] = v))}
                            />
                          ))}
                        </div>
                        {(() => {
                          const controle = resultats.controles.find((c) => c.code === 'bilan_ouverture');
                          if (!controle) {
                            return (
                              <Bandeau ton="succes">
                                Le bilan d’ouverture est équilibré, trésorerie initiale comprise.
                              </Bandeau>
                            );
                          }
                          return (
                            <Bandeau ton="erreur">
                              {controle.message} L’écart de {formaterEuros(controle.ecart)} se
                              propage à tous les exercices : il n’est jamais absorbé d’office.
                            </Bandeau>
                          );
                        })()}
                      </>
                    ) : null}
                  </div>
                </BlocGrille>

                <BlocGrille titre="Notes du dossier">
                  <ChampZoneTexte
                    valeur={dossier.autres.notes}
                    onChange={(v) => definir((d) => void (d.autres.notes = v))}
                    lignes={6}
                    placeholder="Remarques internes, points à confirmer avec le client…"
                  />
                </BlocGrille>
              </>
            ) : null}
          </div>
        );
      }}
    />
  );
}

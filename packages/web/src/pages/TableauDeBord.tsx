import { formaterEuros, formaterPourcentage } from '@previs/core';
import { Link, useParams } from 'react-router-dom';
import { useDossier } from '../store/dossier.js';
import { Bandeau, CarteIndicateur, Chargement, Graphique } from '../ui/divers.js';

/** Synthèse d'un dossier : indicateurs, graphiques, contrôles et sections à compléter. */
export function TableauDeBord() {
  const { id } = useParams<{ id: string }>();
  const { dossier, resultats } = useDossier();
  if (!dossier || !resultats) return <Chargement />;

  const annees = resultats.exercices.map((e) => e.libelle);
  const dernier = annees.length - 1;
  const c = resultats.compteResultat;
  const erreurs = resultats.controles.filter((x) => !x.ok && x.gravite === 'erreur');
  const avertissements = resultats.controles.filter((x) => !x.ok && x.gravite === 'avertissement');

  /** Sections encore vides, pour orienter la saisie. */
  const manquants = [
    { rempli: dossier.recettes.lignes.some((l) => l.actif), chemin: 'recettes', libelle: 'Recettes' },
    { rempli: dossier.charges.lignes.some((l) => l.actif && l.montants.some((v) => v)), chemin: 'charges', libelle: 'Charges' },
    { rempli: dossier.investissements.lignes.some((l) => l.actif), chemin: 'investissements', libelle: 'Investissement' },
    {
      rempli: dossier.financements.apports.some((l) => l.actif) || dossier.financements.emprunts.some((l) => l.actif),
      chemin: 'financements',
      libelle: 'Financement',
    },
    { rempli: dossier.identite.introduction.trim().length > 0, chemin: 'autres', libelle: 'Introduction du rapport' },
  ].filter((x) => !x.rempli);

  return (
    <div className="pile">
      <div>
        <h1>Tableau de bord</h1>
        <div className="discret">
          {dossier.identite.raisonSociale || 'Dossier sans raison sociale'} —{' '}
          {dossier.identite.activite || 'activité non renseignée'}
        </div>
      </div>

      {erreurs.length > 0 ? (
        <Bandeau
          ton="erreur"
          action={
            <Link className="bouton petit" to={`/dossiers/${id}/etats/controles`}>
              Voir les contrôles
            </Link>
          }
        >
          {erreurs.length} contrôle(s) de cohérence en erreur. Le dossier ne doit pas être transmis
          en l’état.
        </Bandeau>
      ) : (
        <Bandeau ton="succes">Tous les contrôles de cohérence obligatoires sont validés.</Bandeau>
      )}

      {manquants.length > 0 ? (
        <Bandeau ton="alerte">
          Sections encore à compléter :{' '}
          {manquants.map((m, i) => (
            <span key={m.chemin}>
              {i > 0 ? ', ' : ''}
              <Link to={`/dossiers/${id}/${m.chemin}`}>{m.libelle}</Link>
            </span>
          ))}
          .
        </Bandeau>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <CarteIndicateur
          valeur={formaterEuros(c[dernier]?.chiffreAffaires ?? 0)}
          libelle={`Chiffre d’affaires ${annees[dernier]}`}
          detail={
            c[0]?.chiffreAffaires
              ? `${formaterPourcentage(((c[dernier].chiffreAffaires - c[0].chiffreAffaires) / c[0].chiffreAffaires) * 100)} sur la période`
              : undefined
          }
        />
        <CarteIndicateur
          valeur={formaterEuros(c[dernier]?.resultatNet ?? 0)}
          libelle={`Résultat net ${annees[dernier]}`}
          ton={(c[dernier]?.resultatNet ?? 0) < 0 ? 'erreur' : 'bon'}
        />
        <CarteIndicateur
          valeur={formaterEuros(resultats.caf[dernier]?.caf ?? 0)}
          libelle="Capacité d’autofinancement"
        />
        <CarteIndicateur
          valeur={formaterEuros(resultats.tresorerie.soldeMinimum)}
          libelle="Trésorerie la plus basse"
          detail={resultats.libellesMois[resultats.tresorerie.moisSoldeMinimum]}
          ton={resultats.tresorerie.soldeMinimum < 0 ? 'erreur' : 'bon'}
        />
        <CarteIndicateur
          valeur={`${resultats.seuilRentabilite[dernier]?.pointMortJours ?? 0} j`}
          libelle="Point mort"
          ton={resultats.seuilRentabilite[dernier]?.atteint ? 'bon' : 'alerte'}
        />
      </div>

      <section className="carte">
        <header>
          <h2>Chiffre d’affaires et résultat</h2>
        </header>
        <div className="corps">
          <Graphique
            type="barres"
            libelles={annees}
            series={[
              { nom: 'Chiffre d’affaires', valeurs: c.map((x) => x.chiffreAffaires) },
              { nom: 'Excédent brut d’exploitation', valeurs: resultats.sig.map((x) => x.excedentBrutExploitation) },
              { nom: 'Résultat net', valeurs: c.map((x) => x.resultatNet) },
            ]}
          />
        </div>
      </section>

      <section className="carte">
        <header>
          <h2>Trésorerie mensuelle</h2>
          <Link className="bouton discret petit" to={`/dossiers/${id}/etats/tresorerie`}>
            Voir le détail
          </Link>
        </header>
        <div className="corps">
          <Graphique
            type="courbe"
            libelles={resultats.libellesMois}
            series={[
              { nom: 'Solde de trésorerie', valeurs: resultats.tresorerie.mensuelle.map((m) => m.soldeFinal) },
            ]}
            hauteur={190}
          />
        </div>
      </section>

      {avertissements.length > 0 ? (
        <section className="carte">
          <header>
            <h2>Points de vigilance</h2>
            <Link className="bouton discret petit" to={`/dossiers/${id}/etats/controles`}>
              Tout voir
            </Link>
          </header>
          <div className="corps">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {avertissements.slice(0, 5).map((a, i) => (
                <li key={i} style={{ marginBottom: 5 }}>
                  <strong>{a.libelle}</strong> — {a.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

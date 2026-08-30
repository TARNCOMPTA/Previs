import { Graphique } from '../../ui/divers.js';
import { TableauEtat, type LigneEtat } from '../../ui/grille.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Soldes intermédiaires de gestion et capacité d'autofinancement. */
export default function Sig() {
  return (
    <AvecResultats
      titre="Soldes intermédiaires de gestion"
      description="La formation du résultat, solde après solde, et la capacité d’autofinancement qui en découle."
      enfant={(r, annees) => {
        const s = r.sig;
        const l = (
          libelle: string,
          extraire: (x: (typeof s)[number]) => number,
          style?: LigneEtat['style'],
        ): LigneEtat => ({ libelle, valeurs: s.map(extraire), style: style ?? 'detail' });

        const lignes: LigneEtat[] = [
          l('Marge commerciale', (x) => x.margeCommerciale),
          l('Production de l’exercice', (x) => x.production),
          l('Marge globale', (x) => x.margeGlobale, 'sous-total'),
          l('Consommations en provenance de tiers', (x) => x.consommationsExterieures),
          l('VALEUR AJOUTÉE', (x) => x.valeurAjoutee, 'total'),
          l('Subventions d’exploitation', (x) => x.subventions),
          l('Impôts et taxes', (x) => x.impotsTaxes),
          l('Charges de personnel', (x) => x.chargesPersonnel),
          l('EXCÉDENT BRUT D’EXPLOITATION', (x) => x.excedentBrutExploitation, 'total'),
          l('Dotations aux amortissements', (x) => x.dotations),
          l('Résultat d’exploitation', (x) => x.resultatExploitation, 'sous-total'),
          l('Résultat courant', (x) => x.resultatCourant, 'sous-total'),
          l('Résultat exceptionnel', (x) => x.resultatExceptionnel),
          l('Impôts sur les bénéfices', (x) => x.impots),
          l('RÉSULTAT NET', (x) => x.resultatNet, 'total'),
        ];

        const caf = r.caf;
        const lignesCaf: LigneEtat[] = [
          { libelle: 'Résultat net', valeurs: caf.map((x) => x.resultatNet), style: 'detail' },
          { libelle: 'Dotations aux amortissements', valeurs: caf.map((x) => x.dotations), style: 'detail' },
          { libelle: 'Reprises de subventions', valeurs: caf.map((x) => -x.repriseSubventions), style: 'detail' },
          { libelle: 'Plus-values de cession', valeurs: caf.map((x) => -x.plusValuesCession), style: 'detail' },
          { libelle: 'CAPACITÉ D’AUTOFINANCEMENT', valeurs: caf.map((x) => x.caf), style: 'total' },
          {
            libelle: 'Autofinancement net des remboursements d’emprunts',
            valeurs: caf.map((x) => x.autofinancementNet),
            style: 'sous-total',
          },
        ];

        return (
          <>
            <BlocEtat titre="La formation du résultat">
              <Graphique
                type="barres"
                libelles={annees}
                series={[
                  { nom: 'Valeur ajoutée', valeurs: s.map((x) => x.valeurAjoutee) },
                  { nom: 'Excédent brut d’exploitation', valeurs: s.map((x) => x.excedentBrutExploitation) },
                  { nom: 'Résultat net', valeurs: s.map((x) => x.resultatNet) },
                ]}
              />
              <TableauEtat entetes={['Solde', ...annees]} lignes={lignes} masquerNuls={false} />
            </BlocEtat>

            <BlocEtat
              titre="Capacité d’autofinancement"
              aide="Les produits sans encaissement sont retranchés : reprises de subvention et plus-values de cession."
            >
              <TableauEtat entetes={['Élément', ...annees]} lignes={lignesCaf} masquerNuls={false} />
            </BlocEtat>
          </>
        );
      }}
    />
  );
}

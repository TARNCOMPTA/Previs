import { formaterPourcentage } from '@previs/core';
import { useState } from 'react';
import { TableauEtat, type LigneEtat } from '../../ui/grille.js';
import { AvecResultats, BlocEtat } from './commun.js';

/** Compte de résultat prévisionnel, avec le pourcentage du chiffre d'affaires. */
export default function CompteResultat() {
  const [avecPourcentage, setAvecPourcentage] = useState(true);

  return (
    <AvecResultats
      titre="Compte de résultat prévisionnel"
      description="Les produits et les charges de chaque exercice, et le résultat qui en découle."
      enfant={(r, annees) => {
        const c = r.compteResultat;
        const dernier = c.length - 1;
        const part = (extraire: (x: (typeof c)[number]) => number) =>
          avecPourcentage
            ? [
                c[dernier].chiffreAffaires
                  ? formaterPourcentage((extraire(c[dernier]) / c[dernier].chiffreAffaires) * 100)
                  : '—',
              ]
            : undefined;

        const l = (
          libelle: string,
          extraire: (x: (typeof c)[number]) => number,
          style?: LigneEtat['style'],
        ): LigneEtat => ({
          libelle,
          valeurs: c.map(extraire),
          style: style ?? 'detail',
          extra: part(extraire),
        });

        const lignes: LigneEtat[] = [
          { libelle: 'Produits d’exploitation', valeurs: [], style: 'groupe' },
          l('Ventes de marchandises', (x) => x.ventesMarchandises),
          l('Production vendue', (x) => x.production),
          l('Subventions d’exploitation', (x) => x.subventionsExploitation),
          l('Autres produits', (x) => x.autresProduits),
          l('Total des produits d’exploitation', (x) => x.totalProduitsExploitation, 'sous-total'),

          { libelle: 'Charges d’exploitation', valeurs: [], style: 'groupe' },
          l('Achats de marchandises', (x) => x.achatsMarchandises),
          l('Variation de stock', (x) => x.variationStock),
          l('Achats de matières premières', (x) => x.achatsMatieres),
          l('Autres achats et fournitures', (x) => x.autresAchats),
          l('Sous-traitance', (x) => x.sousTraitance),
          l('Services extérieurs', (x) => x.servicesExterieurs),
          l('Autres services extérieurs', (x) => x.autresServicesExterieurs),
          l('Impôts, taxes et versements assimilés', (x) => x.impotsTaxes),
          l('Salaires et rémunérations', (x) => x.salairesBruts),
          l('Charges sociales', (x) => x.chargesSociales),
          l('Dotations aux amortissements', (x) => x.dotationsAmortissements),
          l('Autres charges', (x) => x.autresCharges),
          l('Total des charges d’exploitation', (x) => x.totalChargesExploitation, 'sous-total'),

          l('RÉSULTAT D’EXPLOITATION', (x) => x.resultatExploitation, 'total'),

          { libelle: 'Résultat financier', valeurs: [], style: 'groupe' },
          l('Produits financiers', (x) => x.produitsFinanciers),
          l('Charges financières', (x) => x.chargesFinancieres),
          l('RÉSULTAT COURANT AVANT IMPÔT', (x) => x.resultatCourant, 'sous-total'),

          { libelle: 'Résultat exceptionnel', valeurs: [], style: 'groupe' },
          l('Produits exceptionnels', (x) => x.produitsExceptionnels),
          l('Charges exceptionnelles', (x) => x.chargesExceptionnelles),
          l('Résultat exceptionnel', (x) => x.resultatExceptionnel, 'sous-total'),

          l('Résultat avant impôt', (x) => x.resultatAvantImpot, 'sous-total'),
          l('Impôt sur les sociétés', (x) => x.impotSocietes),
          l('RÉSULTAT NET', (x) => x.resultatNet, 'total'),
        ];

        const impotRevenu = c.some((x) => x.impotRevenuEstime !== 0)
          ? [
              {
                libelle: 'Impôt sur le revenu estimé (hors résultat comptable)',
                valeurs: c.map((x) => x.impotRevenuEstime),
                style: 'detail' as const,
                aide: 'L’impôt sur le revenu est personnel : il n’est jamais une charge de l’entreprise.',
              },
            ]
          : [];

        return (
          <BlocEtat titre="Compte de résultat">
            <div className="rangee sans-impression" style={{ marginBottom: 6 }}>
              <label className="rangee" style={{ gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={avecPourcentage}
                  onChange={(e) => setAvecPourcentage(e.target.checked)}
                />
                <span style={{ fontSize: 12.5 }}>Afficher le pourcentage du chiffre d’affaires du dernier exercice</span>
              </label>
            </div>
            <TableauEtat
              entetes={[...['Poste'], ...annees, ...(avecPourcentage ? [`% CA ${annees[dernier]}`] : [])]}
              lignes={[...lignes, ...impotRevenu]}
            />
          </BlocEtat>
        );
      }}
    />
  );
}

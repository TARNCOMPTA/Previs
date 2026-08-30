import { describe, expect, it } from 'vitest';
import { appliquerOperations } from '../src/api/operations.js';
import { dossierVide, normaliserDossier } from '../src/model/dossier.js';
import { zSectionRecettes } from '../src/model/recettes.js';
import { zSectionCharges } from '../src/model/charges.js';
import { EXERCICES_MAX, LIGNES_MAX } from '../src/model/common.js';
import type { Operation } from '../src/api/contract.js';

/**
 * Ces essais verrouillent des corrections de sécurité, pas des règles de calcul.
 * Un échec ici signale qu'une protection a été retirée, jamais qu'un chiffre a bougé.
 */
describe('pollution de prototype', () => {
  const chemins = [
    '__proto__.pollue',
    'identite.__proto__.pollue',
    'constructor.prototype.pollue',
    'identite.constructor.prototype.pollue',
    'parametres.tva.__proto__.pollue',
  ];

  for (const chemin of chemins) {
    it(`le chemin « ${chemin} » n’atteint pas le prototype`, () => {
      const { erreurs } = appliquerOperations(dossierVide(), [
        { action: 'definir', chemin, valeur: 'atteint' } as Operation,
      ]);
      expect(erreurs).toHaveLength(1);
      expect(({} as Record<string, unknown>).pollue).toBeUndefined();
      expect((Object.prototype as Record<string, unknown>).pollue).toBeUndefined();
    });
  }

  it('une racine étrangère au dossier est refusée', () => {
    const { erreurs } = appliquerOperations(dossierVide(), [
      { action: 'definir', chemin: 'process.env.SECRET', valeur: 'x' } as Operation,
    ]);
    expect(erreurs).toHaveLength(1);
  });

  it('une valeur d’objet ne transporte pas de clé « __proto__ »', () => {
    // JSON.parse est le seul moyen d'obtenir une propriété propre nommée « __proto__ » :
    // c'est exactement ce que produit le corps d'une requête HTTP ou d'un appel MCP.
    const valeur = JSON.parse('{"voie":"1 rue du Test","__proto__":{"pollue":"atteint"}}');
    const { dossier } = appliquerOperations(dossierVide(), [
      { action: 'definir', chemin: 'identite.adresse', valeur } as Operation,
    ]);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(dossier.identite.adresse.voie).toBe('1 rue du Test');
  });

  it('une ligne ajoutée ne transporte pas de clé « __proto__ »', () => {
    const ligne = JSON.parse('{"libelle":"Vente","__proto__":{"pollue":"atteint"}}');
    const { dossier } = appliquerOperations(dossierVide(), [
      { action: 'ajouter_ligne', liste: 'recettes.lignes', ligne } as Operation,
    ]);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(dossier.recettes.lignes).toHaveLength(1);
    expect(dossier.recettes.lignes[0].libelle).toBe('Vente');
  });

  it('une ligne modifiée ne transporte pas de clé « constructor »', () => {
    const depart = appliquerOperations(dossierVide(), [
      { action: 'ajouter_ligne', liste: 'recettes.lignes', ligne: { libelle: 'Vente' } } as Operation,
    ]).dossier;
    const id = depart.recettes.lignes[0].id;

    const champs = JSON.parse('{"libelle":"Vente corrigée","constructor":{"pollue":"atteint"}}');
    const { dossier } = appliquerOperations(depart, [
      { action: 'modifier_ligne', liste: 'recettes.lignes', id, champs } as Operation,
    ]);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(dossier.recettes.lignes[0].libelle).toBe('Vente corrigée');
  });

  it('un chemin ne traverse qu’une propriété propre et jamais un tableau', () => {
    const { erreurs } = appliquerOperations(dossierVide(), [
      { action: 'definir', chemin: 'recettes.lignes.0.montants', valeur: [1] } as Operation,
      { action: 'definir', chemin: 'identite.toString', valeur: 'x' } as Operation,
    ]);
    expect(erreurs).toHaveLength(1);
    expect(String({})).toBe('[object Object]');
  });
});

describe('bornes du modèle', () => {
  it('une liste au-delà du plafond est refusée', () => {
    const lignes = Array.from({ length: LIGNES_MAX + 1 }, (_, i) => ({
      id: `r${i}`,
      libelle: `Ligne ${i}`,
    }));
    expect(() => zSectionRecettes.parse({ lignes })).toThrow();
    expect(() => zSectionRecettes.parse({ lignes: lignes.slice(0, LIGNES_MAX) })).not.toThrow();
  });

  it('un tableau par exercice au-delà du plafond est refusé', () => {
    const montants = Array.from({ length: EXERCICES_MAX + 1 }, () => 1000);
    expect(() =>
      zSectionRecettes.parse({ lignes: [{ id: 'r1', libelle: 'A', montants }] }),
    ).toThrow();
  });

  it('les charges sont bornées de la même façon', () => {
    const lignes = Array.from({ length: LIGNES_MAX + 1 }, (_, i) => ({
      id: `c${i}`,
      libelle: `Charge ${i}`,
    }));
    expect(() => zSectionCharges.parse({ lignes })).toThrow();
  });

  it('un dossier de taille courante passe toujours la normalisation', () => {
    const dossier = appliquerOperations(
      dossierVide(),
      Array.from(
        { length: 200 },
        (_, i) =>
          ({
            action: 'ajouter_ligne',
            liste: 'recettes.lignes',
            ligne: { libelle: `Ligne ${i}` },
          }) as Operation,
      ),
    ).dossier;
    expect(dossier.recettes.lignes).toHaveLength(200);
    expect(() => normaliserDossier(dossier)).not.toThrow();
  });
});

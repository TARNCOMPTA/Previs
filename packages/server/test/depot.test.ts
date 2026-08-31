import { beforeEach, describe, expect, it } from 'vitest';
import { completerLigne, type Auteur } from '@previs/core';
import { ouvrirBase, type BaseDonnees } from '../src/base.js';
import { DepotSqlite } from '../src/depot.js';

/**
 * La persistance : ce qui est écrit, ce qui est archivé, et ce qui se défait ensemble.
 *
 * `depot.ts` n'était couvert par aucun essai, alors que c'est la seule pièce qui décide de
 * ce qui reste d'un dossier client. Ces essais-ci portent sur la mécanique — atomicité,
 * historique, purge — et non sur les chiffres, qui sont l'affaire du moteur.
 */
const CLAVIER: Auteur = { id: 'utl_1', nom: 'Aymeric HANGARD', origine: 'interface' };

let base: BaseDonnees;
let depot: DepotSqlite;
let dossierId: string;

beforeEach(async () => {
  base = ouvrirBase(':memory:');
  depot = new DepotSqlite(base);
  const cree = await depot.creer({ nom: 'Essai', modele: 'IS' }, CLAVIER);
  dossierId = cree.id;
});

describe('une écriture se défait tout entière ou pas du tout', () => {
  /*
   * Une écriture compte huit requêtes, dont un DELETE de la version regroupée SUIVI de
   * l'INSERT qui la remplace. Sans transaction, une interruption entre l'UPDATE du dossier
   * et l'INSERT de sa version laissait la ligne à la version N+1 sans archive
   * correspondante : un trou définitif dans l'historique, et un état courant qu'on ne
   * pouvait plus restaurer.
   *
   * L'interruption est provoquée ici par un déclencheur SQLite qui refuse l'archivage.
   * C'est le seul moyen d'éprouver l'atomicité : elle ne se voit que quand quelque chose
   * casse au milieu.
   */
  it('un archivage qui échoue laisse le dossier dans son état d’avant', async () => {
    const avant = await depot.lire(dossierId);
    expect(avant!.version).toBe(1);

    base.exec(`
      CREATE TRIGGER refus_archivage BEFORE INSERT ON versions_dossier
      WHEN NEW.version > 1
      BEGIN SELECT RAISE(ABORT, 'archivage refusé'); END;
    `);

    const modifie = {
      ...avant!.dossier,
      identite: { ...avant!.dossier.identite, raisonSociale: 'NOUVELLE RAISON SOCIALE' },
    };
    await expect(
      depot.enregistrer(dossierId, { dossier: modifie, commentaire: 'Saisie', versionAttendue: 1 }, CLAVIER),
    ).rejects.toThrow(/archivage refusé/);

    base.exec('DROP TRIGGER refus_archivage');

    // Rien n'a bougé : ni la version, ni le contenu, ni le journal.
    const apres = await depot.lire(dossierId);
    expect(apres!.version).toBe(1);
    expect(apres!.dossier.identite.raisonSociale).not.toBe('NOUVELLE RAISON SOCIALE');
    const versions = await depot.versions(dossierId);
    expect(versions.map((v) => v.version)).toEqual([1]);
    const modifications = base
      .prepare("SELECT COUNT(*) AS n FROM journal_audit WHERE action = 'modification_dossier'")
      .get() as { n: number };
    expect(modifications.n).toBe(0);
  });

  it('et une création qui échoue ne laisse pas de dossier sans version', async () => {
    base.exec(`
      CREATE TRIGGER refus_creation BEFORE INSERT ON versions_dossier
      WHEN NEW.dossier_id != '${dossierId}'
      BEGIN SELECT RAISE(ABORT, 'archivage refusé'); END;
    `);
    await expect(depot.creer({ nom: 'Jamais créé', modele: 'IS' }, CLAVIER)).rejects.toThrow(
      /archivage refusé/,
    );
    base.exec('DROP TRIGGER refus_creation');

    const liste = await depot.lister();
    expect(liste.map((d) => d.nom)).toEqual(['Essai']);
  });

  it('une écriture qui aboutit écrit bien tout, elle', async () => {
    const avant = await depot.lire(dossierId);
    const modifie = {
      ...avant!.dossier,
      identite: { ...avant!.dossier.identite, raisonSociale: 'BOULANGERIE DU MARCHÉ' },
    };
    const apres = await depot.enregistrer(
      dossierId,
      { dossier: modifie, commentaire: 'Raison sociale', versionAttendue: 1 },
      CLAVIER,
    );
    expect(apres.version).toBe(2);
    expect(apres.dossier.identite.raisonSociale).toBe('BOULANGERIE DU MARCHÉ');
    expect((await depot.versions(dossierId)).map((v) => v.version)).toEqual([2, 1]);
    const archive = await depot.lireVersion(dossierId, 2);
    expect(archive!.dossier.identite.raisonSociale).toBe('BOULANGERIE DU MARCHÉ');
  });
});

describe('l’ampleur d’un dossier est bornée à l’écriture, jamais à la lecture', () => {
  it('un dossier déjà en base reste lisible quelle que soit sa taille', async () => {
    // On écrit directement en base ce que l'API refuserait : c'est le cas d'un dossier
    // écrit par une version antérieure, ou par une migration.
    // Le dossier respecte chaque plafond de champ — c'est leur SOMME qui dépasse.
    const initial = await depot.lire(dossierId);
    const dossier = {
      ...initial!.dossier,
      charges: {
        ...initial!.dossier.charges,
        lignes: Array.from({ length: 500 }, (_, i) =>
          completerLigne('charges.lignes', {
            id: `c${i}`,
            libelle: `Charge ${i}`.padEnd(200, 'x'),
            note: 'n'.repeat(2000),
            montants: [1000, 1000, 1000],
            repartition: {
              type: 'mensuel',
              montants: Array.from({ length: 10 }, () => Array.from({ length: 24 }, () => 83.33)),
            },
          }),
        ),
      },
    };
    expect(JSON.stringify(dossier).length).toBeGreaterThan(1_500_000);
    base
      .prepare('UPDATE dossiers SET contenu = ? WHERE id = ?')
      .run(JSON.stringify(dossier), dossierId);

    const relu = await depot.lire(dossierId);
    expect(relu!.dossier.charges.lignes).toHaveLength(500);

    // Mais le réécrire est refusé : on ne refuse pas d'afficher ce qu'on a accepté
    // d'écrire, et on n'accepte pas d'en écrire davantage.
    await expect(
      depot.enregistrer(
        dossierId,
        { dossier: relu!.dossier, commentaire: 'Saisie', versionAttendue: relu!.version },
        CLAVIER,
      ),
    ).rejects.toThrow(/pour un maximum de/);
  });
});

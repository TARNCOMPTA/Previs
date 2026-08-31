import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modeleDossier, type Dossier } from '@previs/core';
import { DepotSimule } from './depot-simule.js';

/**
 * Le magasin du dossier : ce qui part au serveur, ce qui est conservé, ce qui est remplacé.
 *
 * L'audit a relevé cinq chemins par lesquels une saisie disparaissait sans un mot. Chacun
 * est rejoué ici sur le VRAI magasin, avec un dépôt simulé qui tient le verrouillage
 * optimiste et une latence réglable — c'est la latence qui ouvre les fenêtres, et un essai
 * sans latence ne verrouille rien.
 *
 * Ce que ces essais surveillent est la règle la plus haute du projet, prise par l'autre
 * bout : ne jamais inventer un chiffre suppose de ne jamais en perdre un.
 */

const LIBELLE_ORIGINE = 'Loyer du local';

let depot: DepotSimule;
/** Le magasin, réimporté à chaque essai : ses minuteries et ses drapeaux vivent au module. */
let magasin: typeof import('../src/store/dossier.js');

function dossierDeDepart(): Dossier {
  const base = modeleDossier('IS');
  const lignes = [...base.charges.lignes];
  lignes[0] = { ...lignes[0], libelle: LIBELLE_ORIGINE };
  return { ...base, charges: { ...base.charges, lignes } };
}

/** Attend que la boucle d'événements ait rendu la main `fois` fois. */
async function respirer(fois = 3): Promise<void> {
  for (let i = 0; i < fois; i++) await Promise.resolve();
}

async function patienter(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Change le libellé de la première ligne de charges, comme le ferait une frappe. */
function taper(texte: string): void {
  const etat = magasin.useDossier.getState();
  const id = etat.dossier!.charges.lignes[0].id;
  etat.modifierLigne('charges.lignes', id, { libelle: texte });
}

beforeEach(async () => {
  vi.resetModules();
  depot = new DepotSimule(dossierDeDepart());

  // Le client HTTP est remplacé : les essais portent sur le magasin, pas sur « fetch ».
  vi.doMock('../src/api/client.js', async () => {
    const reel = await vi.importActual<typeof import('../src/api/client.js')>('../src/api/client.js');
    return {
      ...reel,
      api: {
        lireDossier: () => depot.lire(),
        enregistrerDossier: (_id: string, dossier: Dossier, versionAttendue: number) =>
          depot.enregistrer(dossier, versionAttendue),
      },
    };
  });

  magasin = await import('../src/store/dossier.js');
  await magasin.useDossier.getState().ouvrir('dos_essai');
  expect(magasin.useDossier.getState().dossier, 'le dossier doit être ouvert').toBeTruthy();
});

afterEach(() => {
  magasin.useDossier.getState().fermer();
  vi.doUnmock('../src/api/client.js');
});

describe('quitter un dossier n’efface pas la saisie', () => {
  /*
   * Le chemin, sans attaquant : le comptable tape un montant, clique sur « ← Retour à la
   * liste », et le démontage annule la minuterie de 800 ms sans la déclencher. L'en-tête
   * affichait « Modifications en attente » ; rien n'avertissait.
   */
  it('« fermer() » envoie ce qui restait en attente', async () => {
    taper('Loyer corrigé');
    // On ferme AVANT les 800 ms de l'enregistrement différé, comme le fait un clic.
    magasin.useDossier.getState().fermer();
    await patienter(50);
    expect(depot.libelleCharge()).toBe('Loyer corrigé');
    expect(depot.version).toBe(2);
  });

  it('et n’envoie rien quand il n’y a rien à envoyer', async () => {
    magasin.useDossier.getState().fermer();
    await patienter(50);
    expect(depot.appels.filter((a) => a.startsWith('PUT'))).toHaveLength(0);
  });
});

describe('un envoi en vol n’écrase pas la frappe qui le suit', () => {
  /*
   * Le défaut mesuré : le garde de réentrance portait sur l'état du magasin, que
   * `transformer()` repose à « modifie » à chaque frappe. Deux PUT partaient donc avec la
   * MÊME version attendue, et la réponse du premier adoptait le dossier du serveur — la
   * seconde frappe était détruite, pendant que le bandeau promettait « Votre saisie est
   * conservée ».
   */
  it('un seul PUT à la fois, et la frappe survivante est celle de l’utilisateur', async () => {
    /*
     * La latence doit dépasser le délai d'enregistrement, sans quoi la fenêtre ne s'ouvre
     * pas : c'est la minuterie de la SECONDE frappe qui doit tirer pendant que le premier
     * envoi est encore en vol. Avec 1 000 ms, le premier part à t+800 et revient à t+1800,
     * et la seconde minuterie tire à t+1700.
     */
    depot.latence = 1000;
    taper('PREMIÈRE VALEUR');
    await patienter(900); // l'envoi est parti à t+800 et court encore
    expect(magasin.useDossier.getState().etat).toBe('enregistrement');

    taper('SECONDE VALEUR'); // pendant l'envoi ; minuterie armée pour t+1700
    // Mesuré : retour du premier à t+1800, second envoi à t+2700, retour à t+3600.
    await patienter(3000);

    const etat = magasin.useDossier.getState();
    expect(etat.dossier!.charges.lignes[0].libelle).toBe('SECONDE VALEUR');
    expect(depot.libelleCharge()).toBe('SECONDE VALEUR');
    expect(etat.etat).toBe('a_jour');
    // Deux PUT, et jamais deux fois la même version attendue.
    const puts = depot.appels.filter((a) => a.startsWith('PUT'));
    expect(puts).toEqual(['PUT v1', 'PUT v2']);
  });

  it('la frappe faite pendant l’envoi ne reste pas en attente indéfiniment', async () => {
    depot.latence = 1000;
    taper('UNE');
    await patienter(900);
    taper('DEUX');
    // Aucune frappe supplémentaire, aucun Ctrl+S : le second envoi doit partir seul.
    await patienter(3000);
    expect(magasin.useDossier.getState().etat).toBe('a_jour');
    expect(depot.libelleCharge()).toBe('DEUX');
  });
});

describe('le sondage de synchronisation n’écrase pas une frappe', () => {
  /*
   * Le garde du sondage était évalué AVANT son aller-retour, et la suite de la promesse
   * refermait sur cet état périmé. Une frappe faite pendant le vol du GET était remplacée
   * par la version du serveur — puis l'enregistrement différé partait avec une version
   * périmée et récoltait un conflit. C'est le mode de travail même que décrit le projet :
   * l'assistant écrit pendant que le comptable saisit.
   *
   * Les minuteries sont simulées : l'intervalle réel est de vingt secondes, et c'est le
   * seul moyen d'exercer son corps — et non une imitation — sans faire durer l'essai.
   */
  it('une frappe pendant le vol du GET est conservée', async () => {
    vi.useFakeTimers();
    try {
      // Réouverture sous minuteries simulées : « setInterval » n'est intercepté que s'il
      // est créé après leur installation.
      await magasin.useDossier.getState().ouvrir('dos_essai');
      depot.latence = 1000;
      depot.ecrireAilleurs((d) => {
        d.charges.lignes[0].libelle = 'ÉCRIT PAR L’ASSISTANT';
      });

      // Le tour de sondage part ; sa réponse n'arrivera qu'à t+21 s.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(depot.appels.filter((a) => a === 'GET')).toHaveLength(3);

      taper('SAISIE DU COMPTABLE');
      // La réponse du GET revient ici, pendant que la frappe attend son envoi.
      await vi.advanceTimersByTimeAsync(1200);

      const etat = magasin.useDossier.getState();
      expect(etat.dossier!.charges.lignes[0].libelle).toBe('SAISIE DU COMPTABLE');
      expect(etat.misAJourAilleurs).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mais une écriture faite ailleurs est bien reprise quand rien n’est en cours', async () => {
    vi.useFakeTimers();
    try {
      await magasin.useDossier.getState().ouvrir('dos_essai');
      depot.ecrireAilleurs((d) => {
        d.charges.lignes[0].libelle = 'ÉCRIT PAR L’ASSISTANT';
      });
      await vi.advanceTimersByTimeAsync(20_100);

      const etat = magasin.useDossier.getState();
      expect(etat.dossier!.charges.lignes[0].libelle).toBe('ÉCRIT PAR L’ASSISTANT');
      expect(etat.misAJourAilleurs).toBe(true);
      expect(etat.etat).toBe('a_jour');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un tour de sondage déjà en vol n’écrit plus après la fermeture', async () => {
    vi.useFakeTimers();
    try {
      await magasin.useDossier.getState().ouvrir('dos_essai');
      depot.latence = 1000;
      depot.ecrireAilleurs((d) => {
        d.charges.lignes[0].libelle = 'ÉCRIT PAR L’ASSISTANT';
      });
      await vi.advanceTimersByTimeAsync(20_000);
      magasin.useDossier.getState().fermer();
      await vi.advanceTimersByTimeAsync(1200);
      expect(magasin.useDossier.getState().dossier).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('l’enregistrement préserve le partage structurel', () => {
  /*
   * La réponse du PUT est un graphe entièrement neuf — `normaliserDossier(JSON.parse(…))`.
   * L'adopter changeait les identités de toutes les lignes pour un contenu identique au bit
   * près, et faisait rerendre chaque ligne de chaque grille mémoïsée, 800 ms après chaque
   * pause de saisie.
   */
  it('les lignes gardent leur identité après un enregistrement', async () => {
    taper('Loyer révisé');
    const avant = magasin.useDossier.getState().dossier!;
    const lignesAvant = avant.charges.lignes;
    await patienter(1000);

    const apres = magasin.useDossier.getState();
    expect(apres.etat).toBe('a_jour');
    expect(apres.dossier).toBe(avant);
    expect(apres.dossier!.charges.lignes).toBe(lignesAvant);
    // Et la fiche, elle, est bien rafraîchie : la version doit avoir avancé.
    expect(apres.fiche!.version).toBe(2);
  });
});

describe('une ouverture abandonnée n’écrit plus dans le magasin', () => {
  /*
   * `ouvrir()` n'avait aucun jeton : revenir à la liste pendant que la réponse était en vol
   * laissait celle-ci repeupler le magasin et installer un intervalle de synchronisation que
   * plus aucun démontage ne connaissait — quatre mille trois cents requêtes par jour pour un
   * dossier fermé.
   */
  it('fermer pendant le chargement laisse le magasin vide', async () => {
    magasin.useDossier.getState().fermer();
    depot.latence = 150;
    const ouverture = magasin.useDossier.getState().ouvrir('dos_essai');
    await patienter(30);
    magasin.useDossier.getState().fermer();
    await ouverture;
    await respirer(6);

    const etat = magasin.useDossier.getState();
    expect(etat.dossier).toBeNull();
    expect(etat.fiche).toBeNull();
  });
});

describe('un refus du serveur nomme le champ en cause', () => {
  /*
   * Un 422 rendait « Les données transmises ne respectent pas le format attendu. » et rien de
   * plus. Le dossier restait en erreur, chaque frappe suivante rejouait le même échec, et rien
   * ne disait quelle valeur retirer. Le chemin était pourtant là, dans le `details` du contrat.
   */
  it('le chemin porté par « details » arrive jusqu’au message', async () => {
    const { ErreurRequete } = await import('../src/api/client.js');
    const refus = new ErreurRequete(
      'donnees_invalides',
      'Les données transmises ne respectent pas le format attendu.',
      [{ path: ['charges', 'lignes', 3, 'delaiPaiementJours'], message: 'trop grand' }],
      422,
    );
    depot.enregistrer = () => Promise.reject(refus);

    taper('Peu importe');
    await patienter(1000);

    const etat = magasin.useDossier.getState();
    expect(etat.etat).toBe('erreur');
    expect(etat.messageErreur).toContain('charges › lignes › delaiPaiementJours');
    expect(etat.messageErreur).toContain('trop grand');
  });

  it('une panne ordinaire garde son message, sans mention de champ', async () => {
    depot.enregistrer = () => Promise.reject(new Error('Le serveur est injoignable.'));
    taper('Peu importe');
    await patienter(1000);

    const etat = magasin.useDossier.getState();
    expect(etat.etat).toBe('erreur');
    expect(etat.messageErreur).toBe('Le serveur est injoignable.');
  });
});

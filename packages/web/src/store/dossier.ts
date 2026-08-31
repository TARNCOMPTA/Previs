import {
  ajusterSeries,
  calculer,
  completerLigne,
  normaliserDossier,
  nouvelId,
  type CheminListe,
  type Dossier,
  type DossierEnregistre,
  type Resultats,
} from '@previs/core';
import { create } from 'zustand';
import { api, ErreurRequete } from '../api/client.js';

/** Délai d'inactivité avant enregistrement automatique. */
const DELAI_ENREGISTREMENT = 800;
/** Intervalle de vérification d'une écriture faite ailleurs — par l'assistant, par exemple. */
const INTERVALLE_SYNCHRO = 20000;
/** Profondeur de la pile d'annulation. */
const PROFONDEUR_ANNULATION = 50;

export type EtatEnregistrement = 'a_jour' | 'modifie' | 'enregistrement' | 'conflit' | 'erreur';

interface EtatDossier {
  fiche: DossierEnregistre | null;
  dossier: Dossier | null;
  resultats: Resultats | null;
  erreurCalcul: string | null;
  etat: EtatEnregistrement;
  messageErreur: string | null;
  /** Vrai quand une version plus récente a été détectée sur le serveur. */
  misAJourAilleurs: boolean;
  chargement: boolean;
  pileAnnulation: Dossier[];
  pileRetablissement: Dossier[];

  ouvrir: (id: string) => Promise<void>;
  fermer: () => void;
  modifier: (transformation: (dossier: Dossier) => void, options?: { sansHistorique?: boolean }) => void;
  ajouterLigne: (liste: CheminListe, ligne: Record<string, unknown>) => string;
  dupliquerLigne: (liste: CheminListe, id: string) => void;
  modifierLigne: (liste: CheminListe, id: string, champs: Record<string, unknown>) => void;
  supprimerLigne: (liste: CheminListe, id: string) => void;
  deplacerLigne: (liste: CheminListe, id: string, sens: -1 | 1) => void;
  annuler: () => void;
  retablir: () => void;
  enregistrer: () => Promise<void>;
  recharger: () => Promise<void>;
  definirLogo: (logo: string) => Promise<void>;
}

let minuterieEnregistrement: ReturnType<typeof setTimeout> | null = null;
let minuterieSynchro: ReturnType<typeof setInterval> | null = null;

/**
 * Numéro de l'ouverture en cours. Toute écriture dans le magasin qui suit un aller-retour
 * réseau doit le rapprocher du sien avant d'agir.
 *
 * Sans lui, deux chemins écrivaient dans un magasin qui ne leur appartenait plus. Ouvrir un
 * dossier puis revenir aussitôt à la liste laissait la réponse tardive repeupler le magasin
 * et installer un intervalle de synchronisation que plus aucun démontage ne connaissait —
 * quatre mille trois cents requêtes par jour pour un dossier fermé. Et ouvrir A, revenir,
 * ouvrir B laissait A arriver après B : l'adresse disait B, l'écran montrait A.
 */
let ouvertureCourante = 0;

/**
 * Vrai pendant qu'un PUT est en vol.
 *
 * Distinct de l'état « enregistrement » du magasin, et c'est tout le point : `transformer()`
 * repose « modifie » à chaque frappe, si bien que le garde fondé sur l'état laissait partir un
 * SECOND PUT portant la même `versionAttendue`. Le premier revenait, voyait un état
 * « enregistrement » posé par le second, en concluait que rien n'avait été tapé entre-temps, et
 * adoptait la réponse du serveur : la frappe disparaissait — pendant que le bandeau promettait
 * « Votre saisie est conservée ».
 */
let envoiEnVol = false;

/**
 * Ce qui reste à envoyer, tenu à jour hors du magasin.
 *
 * `fermer()` en a besoin : il annulait la minuterie sans la déclencher, si bien que quitter un
 * dossier dans les 800 ms d'une frappe perdait le montant en silence — le revers exact de
 * « ne jamais inventer un chiffre ». L'avertissement de fermeture d'onglet le lit aussi.
 */
let enAttenteDEnvoi: { fiche: DossierEnregistre; dossier: Dossier } | null = null;

/**
 * Envoie le dossier sans toucher au magasin, au moment où l'on quitte.
 *
 * Elle ne peut pas passer par `enregistrer()`, dont les `set` repeupleraient un dossier qu'on
 * vient de fermer. En contrepartie, un conflit survenant sur ce dernier envoi ne peut plus être
 * montré : l'écran n'existe plus. La prochaine ouverture affichera la version du serveur, ce qui
 * est le comportement d'avant — moins la perte silencieuse du cas courant, où il n'y a pas de
 * conflit.
 */
function envoyerEnQuittant(): void {
  const attente = enAttenteDEnvoi;
  if (!attente) return;
  enAttenteDEnvoi = null;
  void api
    .enregistrerDossier(attente.fiche.id, attente.dossier, attente.fiche.version, 'Saisie', true)
    .catch(() => undefined);
}

// Fermeture de l'onglet ou rechargement : le navigateur n'attend pas la minuterie de 800 ms.
// « pagehide » est le seul événement fiable sur mobile, où « beforeunload » ne se déclenche pas.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', envoyerEnQuittant);
  window.addEventListener('beforeunload', (evenement) => {
    if (!enAttenteDEnvoi) return;
    envoyerEnQuittant();
    // L'envoi part avec « keepalive », mais rien ne garantit qu'il aboutisse : on prévient.
    evenement.preventDefault();
    evenement.returnValue = '';
  });
}

type Ligne = Record<string, unknown>;

/** Accède à une liste de lignes du dossier par son chemin. */
function listeDe(dossier: Dossier, chemin: CheminListe): Ligne[] {
  const [section, propriete] = chemin.split('.') as [keyof Dossier, string];
  const conteneur = dossier[section] as unknown as Record<string, unknown>;
  return conteneur[propriete] as Ligne[];
}

/**
 * Remplace une liste de lignes en ne recréant que le chemin touché.
 *
 * Partage structurel : les lignes non modifiées gardent leur identité, ce qui permet
 * aux composants de grille mémoïsés de ne pas se redessiner et évite de recopier
 * l'intégralité du dossier à chaque frappe.
 */
function avecListe(
  dossier: Dossier,
  chemin: CheminListe,
  transformation: (lignes: Ligne[]) => Ligne[],
): Dossier {
  const [section, propriete] = chemin.split('.') as [keyof Dossier, string];
  const conteneur = dossier[section] as unknown as Record<string, unknown>;
  const lignes = conteneur[propriete] as Ligne[];
  const suivantes = transformation(lignes);
  if (suivantes === lignes) return dossier;
  return {
    ...dossier,
    [section]: { ...conteneur, [propriete]: suivantes },
  } as Dossier;
}

/**
 * Message d'un échec d'enregistrement, en nommant le champ fautif quand on le connaît.
 *
 * Un 422 rendait « Les données transmises ne respectent pas le format attendu. » et rien de
 * plus : le dossier restait en erreur, chaque frappe suivante rejouait le même échec, et rien
 * ne disait quelle valeur refuser. Le `details` du contrat porte les anomalies zod, chemin
 * compris — c'est ce chemin qui manquait à l'écran.
 */
function messageDEchec(e: unknown): string {
  const base = e instanceof Error ? e.message : 'Enregistrement impossible.';
  if (!(e instanceof ErreurRequete) || e.code !== 'donnees_invalides') return base;

  const anomalies = Array.isArray(e.details)
    ? (e.details as Array<{ path?: unknown[]; message?: string }>)
    : [];
  const nommees = anomalies
    .map((a) => {
      const chemin = Array.isArray(a.path) ? a.path.filter((p) => typeof p !== 'number').join(' › ') : '';
      return chemin ? `${chemin}${a.message ? ` (${a.message})` : ''}` : a.message ?? '';
    })
    .filter(Boolean)
    .slice(0, 3);
  if (!nommees.length) return base;
  return `${base} Champ en cause : ${nommees.join(' ; ')}.`;
}

/**
 * Recalcule les états financiers.
 *
 * Une erreur de calcul ne doit jamais faire écran blanc pendant une saisie :
 * elle est capturée et présentée comme une anomalie, les derniers résultats
 * valides restant affichés.
 */
function recalculer(dossier: Dossier): { resultats: Resultats | null; erreur: string | null } {
  try {
    return { resultats: calculer(dossier), erreur: null };
  } catch (e) {
    return { resultats: null, erreur: e instanceof Error ? e.message : String(e) };
  }
}

export const useDossier = create<EtatDossier>((set, get) => {
  /** Programme un enregistrement différé après la dernière frappe. */
  function programmerEnregistrement(): void {
    if (minuterieEnregistrement) clearTimeout(minuterieEnregistrement);
    minuterieEnregistrement = setTimeout(() => void get().enregistrer(), DELAI_ENREGISTREMENT);
  }

  /**
   * Remplace le dossier par une version transformée, recalcule et programme
   * l'enregistrement.
   *
   * `ajusterSeries` remplace ici la validation zod complète : le dossier vient d'une
   * saisie typée, il n'y a rien à valider, seulement des tableaux « par exercice » à
   * compléter si le nombre d'exercices a changé. La validation reste faite aux
   * frontières — chargement depuis le serveur et écriture par le serveur MCP.
   */
  function transformer(
    transformation: (dossier: Dossier) => Dossier,
    options: { sansHistorique?: boolean } = {},
  ): void {
    const courant = get().dossier;
    if (!courant) return;

    const suivant = ajusterSeries(transformation(courant));
    if (suivant === courant) return;

    const { resultats, erreur } = recalculer(suivant);

    set((etat) => ({
      dossier: suivant,
      resultats: resultats ?? etat.resultats,
      erreurCalcul: erreur,
      etat: 'modifie',
      pileAnnulation: options.sansHistorique
        ? etat.pileAnnulation
        : [...etat.pileAnnulation, courant].slice(-PROFONDEUR_ANNULATION),
      pileRetablissement: options.sansHistorique ? etat.pileRetablissement : [],
    }));

    // Tenu hors du magasin, pour que « fermer() » et la fermeture d'onglet sachent ce qui
    // reste à envoyer sans avoir à relire un magasin qu'on est en train de vider.
    const fiche = get().fiche;
    if (fiche) enAttenteDEnvoi = { fiche, dossier: suivant };

    programmerEnregistrement();
  }

  /**
   * Variante mutante, pour les écrans de paramètres et d'identité.
   *
   * Elle recopie le dossier : sans grille de plusieurs dizaines de lignes à redessiner,
   * le coût est sans conséquence et l'écriture des écrans reste directe.
   */
  function appliquer(
    transformation: (dossier: Dossier) => void,
    options: { sansHistorique?: boolean } = {},
  ): void {
    transformer((courant) => {
      const copie = structuredClone(courant) as Dossier;
      transformation(copie);
      return copie;
    }, options);
  }

  return {
    fiche: null,
    dossier: null,
    resultats: null,
    erreurCalcul: null,
    etat: 'a_jour',
    messageErreur: null,
    misAJourAilleurs: false,
    chargement: false,
    pileAnnulation: [],
    pileRetablissement: [],

    async ouvrir(id) {
      const jeton = ++ouvertureCourante;
      if (minuterieSynchro) clearInterval(minuterieSynchro);
      minuterieSynchro = null;
      set({ chargement: true, messageErreur: null, misAJourAilleurs: false });
      try {
        const brut = await api.lireDossier(id);
        // Une autre ouverture, ou une fermeture, a eu lieu pendant l'aller-retour : ce
        // dossier n'est plus celui que l'on veut, et rien de lui ne doit entrer.
        if (jeton !== ouvertureCourante) return;
        // Seule frontière côté interface : le dossier vient du réseau, il est validé.
        const fiche = { ...brut, dossier: normaliserDossier(brut.dossier) };
        const { resultats, erreur } = recalculer(fiche.dossier);
        enAttenteDEnvoi = null;
        set({
          fiche,
          dossier: fiche.dossier,
          resultats,
          erreurCalcul: erreur,
          etat: 'a_jour',
          chargement: false,
          pileAnnulation: [],
          pileRetablissement: [],
        });

        // Surveillance discrète : détecte une écriture faite par l'assistant ou par
        // un autre poste, et ne recharge que si rien n'est en cours de saisie.
        minuterieSynchro = setInterval(() => {
          if (jeton !== ouvertureCourante) return;
          const avant = get();
          if (!avant.fiche || avant.etat !== 'a_jour') return;
          const idOuvert = avant.fiche.id;
          void api
            .lireDossier(idOuvert)
            .then((brut) => {
              /*
               * L'état est RELU ici, et c'est l'essentiel. Le garde du début portait sur un
               * état vieux d'un aller-retour : une frappe faite pendant le vol du GET était
               * remplacée par la version du serveur, puis l'enregistrement différé partait
               * avec une version périmée et récoltait un conflit. Le dossier du client
               * perdait la frappe, et rien ne le disait.
               */
              if (jeton !== ouvertureCourante) return;
              const apres = get();
              if (!apres.fiche || apres.fiche.id !== idOuvert) return;
              if (apres.etat !== 'a_jour') return;
              if (brut.version === apres.fiche.version) return;
              const frais = { ...brut, dossier: normaliserDossier(brut.dossier) };
              const calculs = recalculer(frais.dossier);
              enAttenteDEnvoi = null;
              set({
                fiche: frais,
                dossier: frais.dossier,
                resultats: calculs.resultats ?? apres.resultats,
                erreurCalcul: calculs.erreur,
                misAJourAilleurs: true,
                etat: 'a_jour',
              });
            })
            .catch(() => undefined);
        }, INTERVALLE_SYNCHRO);
      } catch (e) {
        if (jeton !== ouvertureCourante) return;
        set({
          chargement: false,
          etat: 'erreur',
          messageErreur: e instanceof Error ? e.message : 'Chargement impossible.',
        });
      }
    },

    fermer() {
      ouvertureCourante += 1;
      if (minuterieSynchro) clearInterval(minuterieSynchro);
      if (minuterieEnregistrement) clearTimeout(minuterieEnregistrement);
      minuterieSynchro = null;
      minuterieEnregistrement = null;
      // Avant de vider : la minuterie de 800 ms était annulée sans être déclenchée, et un
      // montant tapé juste avant le clic sur « Retour à la liste » ne partait jamais.
      envoyerEnQuittant();
      set({
        fiche: null,
        dossier: null,
        resultats: null,
        erreurCalcul: null,
        etat: 'a_jour',
        messageErreur: null,
        misAJourAilleurs: false,
        pileAnnulation: [],
        pileRetablissement: [],
      });
    },

    modifier: appliquer,

    ajouterLigne(liste, ligne) {
      const id =
        typeof ligne.id === 'string' && ligne.id ? ligne.id : nouvelId(liste.split('.')[1].slice(0, 3));
      // La ligne fournie par l'écran est partielle : son schéma la complète, puisque
      // le moteur ne valide plus à chaque calcul.
      const complete = completerLigne(liste, { ...ligne, id, origine: 'manuel', actif: true });
      transformer((dossier) => avecListe(dossier, liste, (lignes) => [...lignes, complete]));
      return id;
    },

    dupliquerLigne(liste, id) {
      transformer((dossier) =>
        avecListe(dossier, liste, (lignes) => {
          const i = lignes.findIndex((l) => l.id === id);
          if (i < 0) return lignes;
          const copie = structuredClone(lignes[i]);
          copie.id = nouvelId(liste.split('.')[1].slice(0, 3));
          copie.libelle = `${String(lignes[i].libelle ?? '')} (copie)`;
          copie.origine = 'manuel';
          return [...lignes.slice(0, i + 1), copie, ...lignes.slice(i + 1)];
        }),
      );
    },

    modifierLigne(liste, id, champs) {
      transformer((dossier) =>
        avecListe(dossier, liste, (lignes) => {
          const i = lignes.findIndex((l) => l.id === id);
          if (i < 0) return lignes;
          const suivantes = [...lignes];
          suivantes[i] = { ...lignes[i], ...champs };
          return suivantes;
        }),
      );
    },

    supprimerLigne(liste, id) {
      transformer((dossier) =>
        avecListe(dossier, liste, (lignes) => {
          const i = lignes.findIndex((l) => l.id === id);
          return i < 0 ? lignes : [...lignes.slice(0, i), ...lignes.slice(i + 1)];
        }),
      );
    },

    deplacerLigne(liste, id, sens) {
      transformer((dossier) =>
        avecListe(dossier, liste, (lignes) => {
          const i = lignes.findIndex((l) => l.id === id);
          const cible = i + sens;
          if (i < 0 || cible < 0 || cible >= lignes.length) return lignes;
          const suivantes = [...lignes];
          [suivantes[i], suivantes[cible]] = [suivantes[cible], suivantes[i]];
          return suivantes;
        }),
      );
    },

    annuler() {
      const { pileAnnulation, dossier } = get();
      if (pileAnnulation.length === 0 || !dossier) return;
      const precedent = pileAnnulation[pileAnnulation.length - 1];
      const { resultats, erreur } = recalculer(precedent);
      set((etat) => ({
        dossier: precedent,
        resultats: resultats ?? etat.resultats,
        erreurCalcul: erreur,
        pileAnnulation: pileAnnulation.slice(0, -1),
        pileRetablissement: [...etat.pileRetablissement, dossier].slice(-PROFONDEUR_ANNULATION),
        etat: 'modifie',
      }));
      programmerEnregistrement();
    },

    retablir() {
      const { pileRetablissement, dossier } = get();
      if (pileRetablissement.length === 0 || !dossier) return;
      const suivant = pileRetablissement[pileRetablissement.length - 1];
      const { resultats, erreur } = recalculer(suivant);
      set((etat) => ({
        dossier: suivant,
        resultats: resultats ?? etat.resultats,
        erreurCalcul: erreur,
        pileRetablissement: pileRetablissement.slice(0, -1),
        pileAnnulation: [...etat.pileAnnulation, dossier].slice(-PROFONDEUR_ANNULATION),
        etat: 'modifie',
      }));
      programmerEnregistrement();
    },

    async enregistrer() {
      const { fiche, dossier } = get();
      if (!fiche || !dossier) return;

      /*
       * Le garde de réentrance porte sur un drapeau propre à l'envoi, non sur l'état du
       * magasin : `transformer()` repose « modifie » à chaque frappe, si bien qu'un garde
       * fondé sur l'état laissait partir un second PUT avec la même `versionAttendue`.
       * La frappe n'est pas abandonnée pour autant — elle part à la fin de l'envoi en cours.
       */
      // La frappe n'est pas abandonnée : `transformer()` a posé « modifie », et le bloc
      // `finally` de l'envoi en cours reprogrammera pour elle.
      if (envoiEnVol) return;
      envoiEnVol = true;
      const envoye = dossier;
      const jeton = ouvertureCourante;

      set({ etat: 'enregistrement', messageErreur: null });
      try {
        const enregistre = await api.enregistrerDossier(fiche.id, envoye, fiche.version, 'Saisie');
        if (jeton !== ouvertureCourante) return;
        set((courant) => {
          /*
           * C'est l'IDENTITÉ du dossier envoyé qui décide, non l'état. Si le dossier courant
           * n'est plus celui qui vient de partir, une frappe est arrivée entre-temps et c'est
           * elle qui fait foi : adopter la réponse du serveur l'effacerait. Le drapeau de vol
           * interdit déjà deux envois concurrents, si bien que le critère n'est aujourd'hui
           * jamais mis en défaut par un essai — il est gardé parce qu'il reste juste sans lui,
           * là où l'ancien critère fondé sur l'état ne l'était que par accident.
           *
           * Et quand rien n'a changé, on garde tout de même le dossier LOCAL : la réponse du
           * serveur est un graphe entièrement neuf — `normaliserDossier(JSON.parse(…))` — dont
           * l'adoption change les 638 identités d'un dossier de 138 lignes pour un contenu
           * identique au bit près, et fait rerendre chaque ligne de chaque grille mémoïsée.
           */
          const inchange = courant.dossier === envoye;
          return {
            fiche: enregistre,
            dossier: inchange ? envoye : courant.dossier,
            etat: inchange ? 'a_jour' : 'modifie',
            misAJourAilleurs: false,
          };
        });
        if (get().etat === 'a_jour') enAttenteDEnvoi = null;
      } catch (e) {
        if (jeton !== ouvertureCourante) return;
        if (e instanceof ErreurRequete && e.code === 'conflit_version') {
          set({
            etat: 'conflit',
            messageErreur:
              'Ce dossier a été modifié ailleurs — par l’assistant ou depuis un autre poste. ' +
              'Votre saisie n’a pas été enregistrée : notez ce que vous venez de taper, ' +
              'puis rechargez pour repartir de la version du serveur.',
          });
          return;
        }
        set({
          etat: 'erreur',
          messageErreur: messageDEchec(e),
        });
      } finally {
        envoiEnVol = false;
        // Une frappe pendant l'envoi laisse le magasin en « modifie » avec une fiche neuve :
        // il faut un second envoi tout de suite, sans attendre une frappe de plus. Un conflit
        // ou une erreur, en revanche, ne se rejoue pas en boucle.
        if (jeton === ouvertureCourante && get().etat === 'modifie') programmerEnregistrement();
      }
    },

    async recharger() {
      const { fiche } = get();
      if (!fiche) return;
      await get().ouvrir(fiche.id);
    },

    /**
     * Dépose ou retire le logo du client.
     *
     * Le logo n'appartient pas au contenu versionné du dossier : il part par sa propre
     * route et n'entre donc ni dans l'historique, ni dans l'enregistrement différé qui
     * suit la frappe.
     */
    async definirLogo(logo: string) {
      const { fiche } = get();
      if (!fiche) return;
      try {
        const apres = await api.definirLogoDossier(fiche.id, logo);
        set({ fiche: { ...get().fiche!, logo: apres.logo } });
      } catch (e) {
        set({
          etat: 'erreur',
          messageErreur: e instanceof Error ? e.message : 'Le dépôt du logo a échoué.',
        });
      }
    },
  };
});

/** Sélecteur des résultats, avec un repli sur des états vides pendant le chargement. */
export function useResultats(): Resultats | null {
  return useDossier((etat) => etat.resultats);
}

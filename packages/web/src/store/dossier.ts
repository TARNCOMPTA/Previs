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
      set({ chargement: true, messageErreur: null, misAJourAilleurs: false });
      try {
        const brut = await api.lireDossier(id);
        // Seule frontière côté interface : le dossier vient du réseau, il est validé.
        const fiche = { ...brut, dossier: normaliserDossier(brut.dossier) };
        const { resultats, erreur } = recalculer(fiche.dossier);
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
        if (minuterieSynchro) clearInterval(minuterieSynchro);
        minuterieSynchro = setInterval(() => {
          const etat = get();
          if (!etat.fiche || etat.etat !== 'a_jour') return;
          void api
            .lireDossier(etat.fiche.id)
            .then((brut) => {
              if (brut.version === etat.fiche?.version) return;
              const frais = { ...brut, dossier: normaliserDossier(brut.dossier) };
              const calculs = recalculer(frais.dossier);
              set({
                fiche: frais,
                dossier: frais.dossier,
                resultats: calculs.resultats ?? etat.resultats,
                erreurCalcul: calculs.erreur,
                misAJourAilleurs: true,
                etat: 'a_jour',
              });
            })
            .catch(() => undefined);
        }, INTERVALLE_SYNCHRO);
      } catch (e) {
        set({
          chargement: false,
          etat: 'erreur',
          messageErreur: e instanceof Error ? e.message : 'Chargement impossible.',
        });
      }
    },

    fermer() {
      if (minuterieSynchro) clearInterval(minuterieSynchro);
      if (minuterieEnregistrement) clearTimeout(minuterieEnregistrement);
      minuterieSynchro = null;
      minuterieEnregistrement = null;
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
      const { fiche, dossier, etat } = get();
      if (!fiche || !dossier || etat === 'enregistrement') return;

      set({ etat: 'enregistrement', messageErreur: null });
      try {
        const enregistre = await api.enregistrerDossier(fiche.id, dossier, fiche.version, 'Saisie');
        // Une frappe survenue pendant l'enregistrement ne doit pas être écrasée :
        // seule la fiche est rafraîchie, le dossier en cours d'édition est conservé.
        set((courant) => ({
          fiche: enregistre,
          dossier: courant.etat === 'enregistrement' ? enregistre.dossier : courant.dossier,
          etat: courant.etat === 'enregistrement' ? 'a_jour' : 'modifie',
          misAJourAilleurs: false,
        }));
      } catch (e) {
        if (e instanceof ErreurRequete && e.code === 'conflit_version') {
          set({
            etat: 'conflit',
            messageErreur:
              'Ce dossier a été modifié ailleurs — par l’assistant ou depuis un autre poste. ' +
              'Votre saisie est conservée : rechargez pour repartir de la version du serveur.',
          });
          return;
        }
        set({
          etat: 'erreur',
          messageErreur: e instanceof Error ? e.message : 'Enregistrement impossible.',
        });
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

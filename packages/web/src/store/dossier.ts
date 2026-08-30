import {
  calculer,
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
}

let minuterieEnregistrement: ReturnType<typeof setTimeout> | null = null;
let minuterieSynchro: ReturnType<typeof setInterval> | null = null;

/** Accède à une liste de lignes du dossier par son chemin. */
function listeDe(dossier: Dossier, chemin: CheminListe): Array<Record<string, unknown>> {
  const [section, propriete] = chemin.split('.') as [keyof Dossier, string];
  const conteneur = dossier[section] as unknown as Record<string, unknown>;
  return conteneur[propriete] as Array<Record<string, unknown>>;
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

  /** Applique une transformation au dossier, recalcule et programme l'enregistrement. */
  function appliquer(
    transformation: (dossier: Dossier) => void,
    options: { sansHistorique?: boolean } = {},
  ): void {
    const courant = get().dossier;
    if (!courant) return;

    const copie = structuredClone(courant) as Dossier;
    transformation(copie);
    const normalise = normaliserDossier(copie);
    const { resultats, erreur } = recalculer(normalise);

    set((etat) => ({
      dossier: normalise,
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
        const fiche = await api.lireDossier(id);
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
            .then((frais) => {
              if (frais.version === etat.fiche?.version) return;
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
      const id = typeof ligne.id === 'string' && ligne.id ? ligne.id : nouvelId(liste.split('.')[1].slice(0, 3));
      appliquer((dossier) => {
        listeDe(dossier, liste).push({ ...ligne, id, origine: 'manuel', actif: true });
      });
      return id;
    },

    dupliquerLigne(liste, id) {
      appliquer((dossier) => {
        const lignes = listeDe(dossier, liste);
        const source = lignes.find((l) => l.id === id);
        if (!source) return;
        const copie = structuredClone(source);
        copie.id = nouvelId(liste.split('.')[1].slice(0, 3));
        copie.libelle = `${String(source.libelle ?? '')} (copie)`;
        copie.origine = 'manuel';
        lignes.splice(lignes.indexOf(source) + 1, 0, copie);
      });
    },

    modifierLigne(liste, id, champs) {
      appliquer((dossier) => {
        const ligne = listeDe(dossier, liste).find((l) => l.id === id);
        if (ligne) Object.assign(ligne, champs);
      });
    },

    supprimerLigne(liste, id) {
      appliquer((dossier) => {
        const lignes = listeDe(dossier, liste);
        const i = lignes.findIndex((l) => l.id === id);
        if (i >= 0) lignes.splice(i, 1);
      });
    },

    deplacerLigne(liste, id, sens) {
      appliquer((dossier) => {
        const lignes = listeDe(dossier, liste);
        const i = lignes.findIndex((l) => l.id === id);
        const cible = i + sens;
        if (i < 0 || cible < 0 || cible >= lignes.length) return;
        [lignes[i], lignes[cible]] = [lignes[cible], lignes[i]];
      });
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
  };
});

/** Sélecteur des résultats, avec un repli sur des états vides pendant le chargement. */
export function useResultats(): Resultats | null {
  return useDossier((etat) => etat.resultats);
}

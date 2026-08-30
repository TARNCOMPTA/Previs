import {
  appliquerOperations,
  calculer,
  construireExercices,
  dossierVide,
  ErreurDepot,
  modeleDossier,
  normaliserDossier,
  type Auteur,
  type DepotDossiers,
  type Dossier,
  type DossierEnregistre,
  type RequeteCreation,
  type RequeteEnregistrement,
  type RequetePatch,
  type Resultats,
  type ResultatPatch,
  type ResumeDossier,
  type ResumeVersion,
} from '@previs/core';
import { journaliser, type BaseDonnees } from './base.js';
import { genererPdf } from './pdf/index.js';
import { nouvelIdentifiant } from './securite.js';

/** Nombre de versions conservées par dossier. Au-delà, les plus anciennes sont purgées. */
const VERSIONS_CONSERVEES = 100;

interface LigneDossier {
  id: string;
  nom: string;
  contenu: string;
  version: number;
  client: string;
  regime: string;
  type_dossier: string;
  nb_exercices: number;
  annee_debut: string;
  ca_premier_exercice: number;
  coherent: number;
  cree_le: string;
  modifie_le: string;
  modifie_par: string;
}

function versResume(ligne: LigneDossier): ResumeDossier {
  return {
    id: ligne.id,
    nom: ligne.nom,
    client: ligne.client,
    regime: ligne.regime,
    typeDossier: ligne.type_dossier,
    nbExercices: ligne.nb_exercices,
    anneeDebut: ligne.annee_debut,
    caPremierExercice: ligne.ca_premier_exercice,
    version: ligne.version,
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    modifiePar: ligne.modifie_par,
    coherent: ligne.coherent === 1,
  };
}

function versEnregistre(ligne: LigneDossier): DossierEnregistre {
  return { ...versResume(ligne), dossier: JSON.parse(ligne.contenu) as Dossier };
}

/**
 * Indicateurs de la fiche résumé, calculés à chaque écriture.
 *
 * Un dossier dont le calcul échoue reste enregistrable : l'échec est consigné et le
 * dossier marqué incohérent, plutôt que de perdre la saisie de l'utilisateur.
 */
function indicateurs(dossier: Dossier): {
  caPremierExercice: number;
  coherent: boolean;
  anneeDebut: string;
  erreur?: string;
} {
  try {
    const resultats = calculer(dossier);
    return {
      caPremierExercice: resultats.compteResultat[0]?.chiffreAffaires ?? 0,
      coherent: resultats.coherent,
      anneeDebut: resultats.exercices[0]?.libelle ?? '',
    };
  } catch (erreur) {
    const exercices = construireExercices(dossier.parametres);
    return {
      caPremierExercice: 0,
      coherent: false,
      anneeDebut: exercices[0]?.libelle ?? '',
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    };
  }
}

/** Accès aux dossiers sur la base SQLite du serveur. */
export class DepotSqlite implements DepotDossiers {
  constructor(private readonly base: BaseDonnees) {}

  async lister(): Promise<ResumeDossier[]> {
    const lignes = this.base
      .prepare('SELECT * FROM dossiers ORDER BY modifie_le DESC')
      .all() as LigneDossier[];
    return lignes.map(versResume);
  }

  async lire(id: string): Promise<DossierEnregistre | null> {
    const ligne = this.base.prepare('SELECT * FROM dossiers WHERE id = ?').get(id) as
      | LigneDossier
      | undefined;
    return ligne ? versEnregistre(ligne) : null;
  }

  private lireOuEchouer(id: string): LigneDossier {
    const ligne = this.base.prepare('SELECT * FROM dossiers WHERE id = ?').get(id) as
      | LigneDossier
      | undefined;
    if (!ligne) throw new ErreurDepot('introuvable', `Aucun dossier ne porte l’identifiant ${id}.`);
    return ligne;
  }

  async creer(requete: RequeteCreation, auteur: Auteur): Promise<DossierEnregistre> {
    const base =
      requete.dossier ??
      (requete.modele === 'vide' ? dossierVide() : modeleDossier(requete.modele));
    const dossier = normaliserDossier(base);
    if (!dossier.identite.raisonSociale) dossier.identite.raisonSociale = requete.nom;

    const id = nouvelIdentifiant('dos');
    const maintenant = new Date().toISOString();
    const info = indicateurs(dossier);

    this.base
      .prepare(
        `INSERT INTO dossiers (id, nom, contenu, version, client, regime, type_dossier,
           nb_exercices, annee_debut, ca_premier_exercice, coherent, cree_le, modifie_le, modifie_par)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requete.nom,
        JSON.stringify(dossier),
        dossier.identite.raisonSociale,
        dossier.identite.regime,
        dossier.identite.typeDossier,
        dossier.parametres.nbExercices,
        info.anneeDebut,
        info.caPremierExercice,
        info.coherent ? 1 : 0,
        maintenant,
        maintenant,
        auteur.nom,
      );

    this.enregistrerVersion(id, 1, dossier, auteur, 'Création du dossier');
    journaliser(this.base, {
      utilisateur: auteur.nom,
      origine: auteur.origine,
      action: 'creation_dossier',
      cible: id,
      detail: requete.nom,
    });

    return versEnregistre(this.lireOuEchouer(id));
  }

  async enregistrer(
    id: string,
    requete: RequeteEnregistrement,
    auteur: Auteur,
  ): Promise<DossierEnregistre> {
    const ligne = this.lireOuEchouer(id);
    this.verifierVersion(ligne, requete.versionAttendue);
    return this.ecrire(ligne, normaliserDossier(requete.dossier), auteur, requete.commentaire);
  }

  async appliquer(id: string, requete: RequetePatch, auteur: Auteur): Promise<ResultatPatch> {
    const ligne = this.lireOuEchouer(id);
    this.verifierVersion(ligne, requete.versionAttendue);

    const actuel = JSON.parse(ligne.contenu) as Dossier;
    const { dossier, journal, erreurs } = appliquerOperations(actuel, requete.operations);
    const commentaire =
      requete.commentaire || `${journal.length} modification(s) par l’assistant`;
    const enregistre = this.ecrire(ligne, dossier, auteur, commentaire);
    return { dossier: enregistre, journal, erreurs };
  }

  async supprimer(id: string): Promise<void> {
    const ligne = this.lireOuEchouer(id);
    this.base.prepare('DELETE FROM dossiers WHERE id = ?').run(id);
    journaliser(this.base, {
      utilisateur: '',
      origine: 'interface',
      action: 'suppression_dossier',
      cible: id,
      detail: ligne.nom,
    });
  }

  async dupliquer(id: string, auteur: Auteur): Promise<DossierEnregistre> {
    const ligne = this.lireOuEchouer(id);
    const dossier = JSON.parse(ligne.contenu) as Dossier;
    return this.creer({ nom: `${ligne.nom} (copie)`, dossier, modele: 'vide' }, auteur);
  }

  async versions(id: string): Promise<ResumeVersion[]> {
    this.lireOuEchouer(id);
    const lignes = this.base
      .prepare(
        `SELECT version, cree_le, auteur, commentaire, origine
         FROM versions_dossier WHERE dossier_id = ? ORDER BY version DESC`,
      )
      .all(id) as Array<{
      version: number;
      cree_le: string;
      auteur: string;
      commentaire: string;
      origine: string;
    }>;
    return lignes.map((l) => ({
      version: l.version,
      creeLe: l.cree_le,
      auteur: l.auteur,
      commentaire: l.commentaire,
      origine: l.origine as ResumeVersion['origine'],
    }));
  }

  async lireVersion(id: string, version: number): Promise<DossierEnregistre | null> {
    const ligne = this.lireOuEchouer(id);
    const archive = this.base
      .prepare('SELECT contenu FROM versions_dossier WHERE dossier_id = ? AND version = ?')
      .get(id, version) as { contenu: string } | undefined;
    if (!archive) return null;
    return { ...versResume(ligne), version, dossier: JSON.parse(archive.contenu) as Dossier };
  }

  async restaurer(id: string, version: number, auteur: Auteur): Promise<DossierEnregistre> {
    const archive = await this.lireVersion(id, version);
    if (!archive) {
      throw new ErreurDepot('introuvable', `La version ${version} de ce dossier n’existe pas.`);
    }
    const ligne = this.lireOuEchouer(id);
    return this.ecrire(
      ligne,
      normaliserDossier(archive.dossier),
      auteur,
      `Restauration de la version ${version}`,
    );
  }

  async calculer(id: string): Promise<Resultats> {
    const enregistre = await this.lire(id);
    if (!enregistre) throw new ErreurDepot('introuvable', 'Dossier introuvable.');
    return calculer(enregistre.dossier);
  }

  async pdf(id: string): Promise<Uint8Array> {
    const enregistre = await this.lire(id);
    if (!enregistre) throw new ErreurDepot('introuvable', 'Dossier introuvable.');
    const resultats = calculer(enregistre.dossier);
    return genererPdf(enregistre.dossier, resultats, { titre: enregistre.nom });
  }

  // ─── Écriture ───────────────────────────────────────────────────────────────

  /**
   * Rejette une écriture fondée sur une version périmée.
   *
   * Le dossier à jour accompagne l'erreur : l'appelant — interface ou serveur MCP —
   * peut ainsi relire, rejouer sa modification et réécrire sans rien perdre.
   */
  private verifierVersion(ligne: LigneDossier, attendue?: number): void {
    if (attendue === undefined || attendue === ligne.version) return;
    throw new ErreurDepot(
      'conflit_version',
      `Le dossier a été modifié entre-temps : version ${ligne.version} en base, ${attendue} attendue.`,
      { dossier: versEnregistre(ligne) },
    );
  }

  private ecrire(
    ligne: LigneDossier,
    dossier: Dossier,
    auteur: Auteur,
    commentaire: string,
  ): DossierEnregistre {
    const version = ligne.version + 1;
    const maintenant = new Date().toISOString();
    const info = indicateurs(dossier);

    this.base
      .prepare(
        `UPDATE dossiers SET contenu = ?, version = ?, client = ?, regime = ?, type_dossier = ?,
           nb_exercices = ?, annee_debut = ?, ca_premier_exercice = ?, coherent = ?,
           modifie_le = ?, modifie_par = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(dossier),
        version,
        dossier.identite.raisonSociale,
        dossier.identite.regime,
        dossier.identite.typeDossier,
        dossier.parametres.nbExercices,
        info.anneeDebut,
        info.caPremierExercice,
        info.coherent ? 1 : 0,
        maintenant,
        auteur.nom,
        ligne.id,
      );

    this.enregistrerVersion(ligne.id, version, dossier, auteur, commentaire);
    journaliser(this.base, {
      utilisateur: auteur.nom,
      origine: auteur.origine,
      action: 'modification_dossier',
      cible: ligne.id,
      detail: info.erreur ? `${commentaire} — échec du calcul : ${info.erreur}` : commentaire,
    });

    return versEnregistre(this.lireOuEchouer(ligne.id));
  }

  private enregistrerVersion(
    id: string,
    version: number,
    dossier: Dossier,
    auteur: Auteur,
    commentaire: string,
  ): void {
    this.base
      .prepare(
        `INSERT OR REPLACE INTO versions_dossier
           (dossier_id, version, contenu, auteur, commentaire, origine, cree_le)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        version,
        JSON.stringify(dossier),
        auteur.nom,
        commentaire,
        auteur.origine,
        new Date().toISOString(),
      );

    this.base
      .prepare(
        `DELETE FROM versions_dossier
         WHERE dossier_id = ? AND version <= ?`,
      )
      .run(id, version - VERSIONS_CONSERVEES);
  }
}

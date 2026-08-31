import { normaliserDossier, type Dossier, type DossierEnregistre } from '@previs/core';
import { ErreurRequete } from '../src/api/client.js';

/**
 * Un dépôt en mémoire, avec verrouillage optimiste et latence réglable.
 *
 * Il tient exactement les deux promesses du vrai serveur dont dépendent les essais du
 * magasin : la version s'incrémente à chaque écriture, et une écriture fondée sur une
 * version périmée est refusée. Et il rend, comme lui, un GRAPHE ENTIÈREMENT NEUF —
 * `normaliserDossier(JSON.parse(…))` — ce qui est la cause du défaut d'identité que
 * l'un des essais verrouille.
 */
export class DepotSimule {
  version = 1;
  contenu: string;
  /** Latence de chaque appel, en millisecondes. */
  latence = 0;
  /** Journal des appels, dans l'ordre. */
  readonly appels: string[] = [];

  constructor(dossier: Dossier) {
    this.contenu = JSON.stringify(dossier);
  }

  /** Écriture faite ailleurs : par l'assistant, ou depuis un autre poste. */
  ecrireAilleurs(transformation: (dossier: Dossier) => void): void {
    const copie = JSON.parse(this.contenu) as Dossier;
    transformation(copie);
    this.contenu = JSON.stringify(copie);
    this.version += 1;
  }

  private async attendre(): Promise<void> {
    if (this.latence) await new Promise((r) => setTimeout(r, this.latence));
  }

  private fiche(): DossierEnregistre {
    return {
      id: 'dos_essai',
      nom: 'Essai',
      client: 'Client d’essai',
      anneeDebut: '2026',
      version: this.version,
      creeLe: '2026-01-01T00:00:00.000Z',
      modifieLe: '2026-01-01T00:00:00.000Z',
      logo: null,
      dossier: normaliserDossier(JSON.parse(this.contenu) as Dossier),
    } as DossierEnregistre;
  }

  async lire(): Promise<DossierEnregistre> {
    this.appels.push('GET');
    await this.attendre();
    return this.fiche();
  }

  async enregistrer(dossier: Dossier, versionAttendue: number): Promise<DossierEnregistre> {
    this.appels.push(`PUT v${versionAttendue}`);
    await this.attendre();
    // La vraie erreur du client HTTP : c'est sur son `code` que le magasin distingue le
    // conflit d'une panne, et un essai qui lèverait autre chose ne prouverait rien.
    if (versionAttendue !== this.version) {
      throw new ErreurRequete('conflit_version', 'Conflit de version.', undefined, 409);
    }
    this.contenu = JSON.stringify(dossier);
    this.version += 1;
    return this.fiche();
  }

  /** Le libellé de la première ligne de charges, tel que le dépôt le détient. */
  libelleCharge(): string {
    return (JSON.parse(this.contenu) as Dossier).charges.lignes[0]?.libelle ?? '';
  }
}

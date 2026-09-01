/**
 * Plafond d'impressions simultanées, et délai maximal d'une impression.
 *
 * Ces deux mécanismes vivent à part du générateur pour une seule raison : ils sont
 * éprouvables sans lancer Chromium. Ce qu'ils protègent — la mémoire du VPS, et un jeton
 * qui ne revient jamais — ne se constate autrement qu'en production, trop tard.
 */

/**
 * File d'attente à jetons : au plus `simultanees` impressions à la fois.
 *
 * Mesuré en PSS cumulé de l'arbre Chromium — la somme des RSS compte la mémoire partagée
 * une fois par processus et double le résultat : le navigateur partagé pèse 242 Mo à lui
 * seul, et un export en vol ajoute 127 Mo par-dessus (pointe à 369). Le plafond porte donc
 * sur le surcoût, pas sur le coût total : deux exports simultanés demandent 500 Mo, non
 * 250. Sans plafond, les trente exports qu'autorise la limitation de débit par quart
 * d'heure pouvaient partir ensemble et réclamer quatre gigaoctets — le VPS n'en a pas tant,
 * et c'est l'OOM. Les suivants attendent leur tour, ce qui est très préférable à un serveur
 * abattu.
 */
export class FileImpressions {
  private enCours = 0;
  private readonly attente: Array<() => void> = [];

  constructor(
    private readonly simultanees: number,
    /** Au-delà, la demande est refusée plutôt que de faire la queue indéfiniment. */
    private readonly attenteMaximale: number,
  ) {}

  /** Impressions en cours, pour les essais et pour la route d'état. */
  get occupees(): number {
    return this.enCours;
  }

  /** Demandes en attente d'un jeton. */
  get enFile(): number {
    return this.attente.length;
  }

  /** Prend un jeton, ou refuse si la file est déjà trop longue. */
  async prendre(): Promise<void> {
    if (this.enCours < this.simultanees) {
      this.enCours += 1;
      return;
    }
    if (this.attente.length >= this.attenteMaximale) {
      throw new Error('Trop d’exports simultanés sur le serveur. Réessayer dans quelques instants.');
    }
    // Le jeton est déjà compté par « rendre » au moment où il nous est transmis : on ne
    // l'incrémente pas ici.
    await new Promise<void>((resoudre) => this.attente.push(resoudre));
  }

  /**
   * Rend un jeton — ou plutôt le TRANSMET au premier de la file.
   *
   * Décrémenter puis réveiller, ce que faisait la première version, laissait le compteur
   * sous le plafond le temps d'une micro-tâche : un appelant arrivant dans cet intervalle
   * prenait la place que le premier de la file s'apprêtait à occuper, et trois Chromium
   * tournaient là où le plafond en promettait deux. Le passage de main ne laisse aucun
   * intervalle.
   */
  rendre(): void {
    const suivant = this.attente.shift();
    if (suivant) suivant();
    else this.enCours -= 1;
  }
}

/**
 * Impose un délai à une promesse dont on ne contrôle pas l'annulation.
 *
 * La promesse abandonnée continue de vivre : chez l'appelant, c'est la fermeture du
 * contexte Chromium, en « finally », qui met fin au rendu. Sans le « catch » vide, son
 * rejet ultérieur remonterait en refus non intercepté et couperait le processus du serveur.
 */
export async function avecDelai<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesse,
      new Promise<never>((_, rejeter) => {
        minuterie = setTimeout(
          () =>
            rejeter(
              new Error(
                `L’impression a dépassé ${Math.round(delaiMs / 1000)} secondes et a été abandonnée.`,
              ),
            ),
          delaiMs,
        );
      }),
    ]);
  } finally {
    if (minuterie) clearTimeout(minuterie);
    void promesse.catch(() => undefined);
  }
}

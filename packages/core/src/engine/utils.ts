/** Arrondi à l'euro, en évitant les artefacts de virgule flottante. */
export function euro(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/** Arrondi à l'euro entier, format d'affichage des tableaux du dossier. */
export function euroEntier(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

export function somme(valeurs: readonly number[]): number {
  let t = 0;
  for (const v of valeurs) t += Number.isFinite(v) ? v : 0;
  return t;
}

/** Tableau de `n` zéros. */
export function zeros(n: number): number[] {
  return new Array<number>(Math.max(0, n)).fill(0);
}

/** Additionne `b` dans `a`, en place. Les tableaux doivent avoir la même longueur. */
export function ajouter(a: number[], b: readonly number[]): number[] {
  for (let i = 0; i < a.length; i++) a[i] += b[i] ?? 0;
  return a;
}

/** Valeur d'un tableau « par exercice », 0 si absente. */
export function val(t: readonly number[] | undefined, i: number): number {
  const v = t?.[i];
  return Number.isFinite(v) ? (v as number) : 0;
}

/** Convertit un pourcentage (20) en coefficient (0,2). */
export function pct(taux: number): number {
  return (Number.isFinite(taux) ? taux : 0) / 100;
}

/** Division protégée : renvoie 0 plutôt que NaN ou Infinity. */
export function div(a: number, b: number): number {
  if (!b || !Number.isFinite(b) || !Number.isFinite(a)) return 0;
  return a / b;
}

/** Répartit un montant sur `n` parts en corrigeant l'arrondi sur la dernière part. */
export function repartirEgal(montant: number, n: number): number[] {
  if (n <= 0) return [];
  const part = euro(montant / n);
  const t = new Array<number>(n).fill(part);
  t[n - 1] = euro(montant - part * (n - 1));
  return t;
}

/** Répartit un montant au prorata de poids, en corrigeant l'arrondi sur la dernière part non nulle. */
export function repartirProrata(montant: number, poids: readonly number[]): number[] {
  const total = somme(poids);
  if (total <= 0) return repartirEgal(montant, poids.length);
  const t = poids.map((p) => euro((montant * p) / total));
  const ecart = euro(montant - somme(t));
  for (let i = t.length - 1; i >= 0; i--) {
    if (poids[i] > 0) {
      t[i] = euro(t[i] + ecart);
      break;
    }
  }
  return t;
}

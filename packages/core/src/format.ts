/**
 * Formatage des nombres à la française, partagé par l'interface et le PDF.
 * Le séparateur de milliers est une espace insécable étroite, conformément
 * à la charte des dossiers TARN COMPTA.
 */

const ESPACE_INSECABLE = ' ';

/** « 319 905 » — montant entier, sans symbole. */
export function formaterMontant(valeur: number, decimales = 0): string {
  if (!Number.isFinite(valeur)) return '—';
  const negatif = valeur < 0;
  const abs = Math.abs(valeur);
  const fixe = abs.toFixed(decimales);
  const [entier, frac] = fixe.split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_INSECABLE);
  const corps = frac ? `${groupe},${frac}` : groupe;
  return negatif ? `−${corps}` : corps;
}

/** « 319 905 € ». */
export function formaterEuros(valeur: number, decimales = 0): string {
  if (!Number.isFinite(valeur)) return '—';
  return `${formaterMontant(valeur, decimales)}${ESPACE_INSECABLE}€`;
}

/** « 12,5 % ». */
export function formaterPourcentage(valeur: number, decimales = 1): string {
  if (!Number.isFinite(valeur)) return '—';
  return `${formaterMontant(valeur, decimales)}${ESPACE_INSECABLE}%`;
}

/** Affiche un zéro comme un tiret cadratin, pour alléger les tableaux. */
export function formaterMontantOuVide(valeur: number, decimales = 0): string {
  if (!Number.isFinite(valeur) || Math.round(valeur) === 0) return '—';
  return formaterMontant(valeur, decimales);
}

/** « 15/03/2026 » à partir d'une date ISO. */
export function formaterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** « 01/2026 à 12/2028 » — période couverte, telle qu'affichée en page de garde. */
export function formaterPeriode(debutIso: string, finIso: string): string {
  const d = /^(\d{4})-(\d{2})/.exec(debutIso);
  const f = /^(\d{4})-(\d{2})/.exec(finIso);
  if (!d || !f) return '';
  return `${d[2]}/${d[1]} à ${f[2]}/${f[1]}`;
}

/** Analyse une saisie française (« 12 500,50 », « 12500.5 ») en nombre. */
export function analyserMontant(saisie: string): number {
  if (typeof saisie !== 'string') return 0;
  const nettoye = saisie
    .replace(/[\s  ]/g, '')
    .replace(/€/g, '')
    .replace(/−/g, '-')
    .replace(',', '.');
  const v = Number.parseFloat(nettoye);
  return Number.isFinite(v) ? v : 0;
}

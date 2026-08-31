import { analyserMontant, formaterMontant } from '@previs/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ProprietesBase {
  /** Libellé affiché au-dessus du champ. Omis dans une grille, où l'en-tête suffit. */
  libelle?: string;
  aide?: string;
  desactive?: boolean;
  invalide?: boolean;
  titre?: string;
}

function Enveloppe({
  libelle,
  aide,
  children,
}: {
  libelle?: string;
  aide?: string;
  children: ReactNode;
}) {
  if (!libelle && !aide) return <>{children}</>;
  return (
    <div>
      {libelle ? <label className="libelle">{libelle}</label> : null}
      {children}
      {aide ? <div className="aide-champ">{aide}</div> : null}
    </div>
  );
}

interface ProprietesMontant extends ProprietesBase {
  valeur: number;
  onChange: (valeur: number) => void;
  /** Nombre de décimales affichées hors saisie. */
  decimales?: number;
  suffixe?: string;
}

/**
 * Saisie d'un montant en euros.
 *
 * Le champ affiche la valeur formatée à la française quand il n'a pas le focus, et
 * la valeur brute pendant la frappe. « 12 500,50 » comme « 12500.5 » sont acceptés.
 * Le contenu est sélectionné à la prise de focus, pour remplacer d'une seule frappe.
 */
export function ChampMontant({
  valeur,
  onChange,
  decimales = 0,
  suffixe,
  libelle,
  aide,
  desactive,
  invalide,
  titre,
}: ProprietesMontant) {
  const [saisie, setSaisie] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  const affichage = saisie ?? (valeur === 0 ? '' : formaterMontant(valeur, decimales));

  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <input
        ref={champ}
        className={`champ nombre${invalide ? ' invalide' : ''}`}
        inputMode="decimal"
        value={affichage}
        title={titre}
        disabled={desactive}
        placeholder={suffixe ? `— ${suffixe}` : '—'}
        onFocus={() => {
          setSaisie(valeur === 0 ? '' : String(valeur));
          requestAnimationFrame(() => champ.current?.select());
        }}
        onChange={(e) => setSaisie(e.target.value)}
        onBlur={() => {
          if (saisie !== null) onChange(analyserMontant(saisie));
          setSaisie(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setSaisie(null);
            e.currentTarget.blur();
          }
        }}
      />
    </Enveloppe>
  );
}

/** Saisie d'un taux en pourcentage : 20 signifie 20 %. */
export function ChampTaux(proprietes: Omit<ProprietesMontant, 'suffixe'>) {
  return <ChampMontant {...proprietes} decimales={proprietes.decimales ?? 2} suffixe="%" />;
}

/**
 * Saisie d'un entier simple (effectif, durée, nombre de mois).
 *
 * Deux précautions qui ne se devinent pas, et que l'audit a trouvées manquantes :
 *
 * 1. **Un champ vidé ne vaut pas zéro.** `Number('')` rend 0 : vider le champ pour retaper
 *    une valeur inscrivait donc 0 dans le dossier à cet instant, recalculait tout le
 *    prévisionnel et poussait une entrée d'annulation. Sur un effectif ou un nombre de mois,
 *    c'est un chiffre faux, brièvement affiché dans le volet de résultat. La saisie vide est
 *    tenue localement et rien n'est remonté tant qu'elle dure ; le `blur` rétablit la valeur.
 * 2. **Les bornes sont appliquées, pas seulement déclarées.** `min` et `max` sur un `input`
 *    n'empêchent pas de SAISIR 400 dans un champ borné à 365 par le modèle. Le moteur ne
 *    validant pas, la valeur traversait le magasin et se calculait ; c'est le PUT qui la
 *    refusait, en 422, avec un message qui ne nommait pas le champ — et chaque frappe
 *    suivante rejouait le même échec.
 */
export function ChampNombre({
  valeur,
  onChange,
  min,
  max,
  pas = 1,
  libelle,
  aide,
  desactive,
}: ProprietesBase & { valeur: number; onChange: (v: number) => void; min?: number; max?: number; pas?: number }) {
  const [saisie, setSaisie] = useState<string | null>(null);
  const affichee = saisie ?? String(Number.isFinite(valeur) ? valeur : 0);

  const remonter = (brut: string): void => {
    if (brut.trim() === '') return;
    const nombre = Number(brut);
    if (!Number.isFinite(nombre)) return;
    let borne = nombre;
    if (min !== undefined) borne = Math.max(min, borne);
    if (max !== undefined) borne = Math.min(max, borne);
    if (borne !== valeur) onChange(borne);
  };

  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <input
        className="champ nombre"
        type="number"
        value={affichee}
        min={min}
        max={max}
        step={pas}
        disabled={desactive}
        onChange={(e) => {
          setSaisie(e.target.value);
          remonter(e.target.value);
        }}
        onBlur={() => setSaisie(null)}
      />
    </Enveloppe>
  );
}

export function ChampTexte({
  valeur,
  onChange,
  placeholder,
  libelle,
  aide,
  desactive,
  invalide,
  longueurMax,
}: ProprietesBase & {
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  longueurMax?: number;
}) {
  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <input
        className={`champ${invalide ? ' invalide' : ''}`}
        value={valeur}
        placeholder={placeholder}
        maxLength={longueurMax}
        disabled={desactive}
        onChange={(e) => onChange(e.target.value)}
      />
    </Enveloppe>
  );
}

export function ChampZoneTexte({
  valeur,
  onChange,
  libelle,
  aide,
  lignes = 8,
  placeholder,
  compteur,
}: ProprietesBase & {
  valeur: string;
  onChange: (v: string) => void;
  lignes?: number;
  placeholder?: string;
  compteur?: boolean;
}) {
  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <textarea
        className="champ"
        rows={lignes}
        value={valeur}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {compteur ? (
        <div className="aide-champ">
          {valeur.trim() ? `${valeur.trim().split(/\n\s*\n/).length} paragraphe(s), ` : ''}
          {valeur.length} caractères
        </div>
      ) : null}
    </Enveloppe>
  );
}

export function ChampDate({
  valeur,
  onChange,
  libelle,
  aide,
  desactive,
}: ProprietesBase & { valeur: string; onChange: (v: string) => void }) {
  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <input
        className="champ"
        type="date"
        value={valeur}
        disabled={desactive}
        onChange={(e) => onChange(e.target.value)}
      />
    </Enveloppe>
  );
}

export function Selecteur<T extends string>({
  valeur,
  onChange,
  options,
  libelle,
  aide,
  desactive,
}: ProprietesBase & {
  valeur: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ valeur: T; libelle: string }>;
}) {
  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <select
        className="champ"
        value={valeur}
        disabled={desactive}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </select>
    </Enveloppe>
  );
}

/** Bascule à deux états, avec son libellé cliquable. */
export function Interrupteur({
  valeur,
  onChange,
  libelle,
  aide,
  desactive,
}: ProprietesBase & { valeur: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="rangee" style={{ cursor: desactive ? 'default' : 'pointer', gap: 6 }}>
        <input
          type="checkbox"
          checked={valeur}
          disabled={desactive}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{ fontSize: 12.5 }}>{libelle}</span>
      </label>
      {aide ? <div className="aide-champ">{aide}</div> : null}
    </div>
  );
}

/** Info-bulle discrète, déclenchée au survol et au focus clavier. */
export function InfoBulle({ texte, children }: { texte: string; children?: ReactNode }) {
  return (
    <span title={texte} tabIndex={0} style={{ cursor: 'help', color: 'var(--texte-faible)' }}>
      {children ?? '?'}
    </span>
  );
}

/** Restaure le focus sur un élément à son montage : utile après l'ajout d'une ligne. */
export function useFocusAuMontage<T extends HTMLElement>(actif = true) {
  const reference = useRef<T>(null);
  useEffect(() => {
    if (actif) reference.current?.focus();
  }, [actif]);
  return reference;
}

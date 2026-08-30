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

/** Saisie d'un entier simple (effectif, durée, nombre de mois). */
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
  return (
    <Enveloppe libelle={libelle} aide={aide}>
      <input
        className="champ nombre"
        type="number"
        value={Number.isFinite(valeur) ? valeur : 0}
        min={min}
        max={max}
        step={pas}
        disabled={desactive}
        onChange={(e) => onChange(Number(e.target.value))}
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

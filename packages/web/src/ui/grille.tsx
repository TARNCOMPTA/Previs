import { formaterMontant } from '@previs/core';
import { memo, useCallback, useState, type ReactNode } from 'react';

export interface Colonne<T> {
  cle: string;
  entete: string;
  /** Largeur indicative en pixels, appliquée en largeur minimale. */
  largeur?: number;
  /** Cellule affichée pour une ligne. */
  rendu: (ligne: T, index: number) => ReactNode;
  /**
   * Valeur numérique servant au total de colonne. Omise, la colonne n'a pas de total.
   *
   * Elle est appelée par le pied du tableau, jamais par une ligne. C'est important : le pied
   * n'est pas mémoïsé, les lignes le sont, et une même fonction employée des deux côtés
   * obligerait à choisir entre un total périmé et des lignes qui rerendent toutes. D'où
   * « totauxFrais » ci-dessous, qui permet à un écran de garder ses colonnes stables tout en
   * recalculant ses totaux à chaque frappe.
   */
  total?: (ligne: T) => number;
  aide?: string;
  alignementGauche?: boolean;
}

interface ProprietesGrille<T> {
  colonnes: Array<Colonne<T>>;
  lignes: T[];
  /** Identifiant stable d'une ligne. */
  cle: (ligne: T) => string;
  /** Vrai si la ligne a été proposée par l'assistant : elle est alors signalée. */
  estProposee?: (ligne: T) => boolean;
  onSupprimer?: (ligne: T) => void;
  onDupliquer?: (ligne: T) => void;
  onDeplacer?: (ligne: T, sens: -1 | 1) => void;
  /** Contenu déplié sous une ligne, pour ses réglages fins. */
  detail?: (ligne: T) => ReactNode;
  messageVide?: string;
  libelleTotal?: string;
  /** Actions rendues sous la grille, typiquement les boutons d'ajout. */
  actions?: ReactNode;
  /**
   * Totaux calculés à chaque rendu, par clé de colonne, quand ils dépendent des résultats.
   *
   * Ils l'emportent sur « Colonne.total ». C'est ce qui permet à un écran de mémoïser ses
   * colonnes — condition de la mémoïsation des lignes — sans figer un total : une colonne
   * dont le total vient du moteur ne peut pas être calculée par une fonction mémoïsée sans
   * capturer des résultats périmés, et un total périmé est un chiffre faux.
   */
  totauxFrais?: Readonly<Record<string, number>>;
}

/**
 * Tableau de saisie.
 *
 * Chaque ligne peut être dépliée pour ses réglages fins — répartition mensuelle, TVA,
 * délai de règlement — afin que la grille principale reste lisible. Les lignes venues
 * de l'assistant portent un liseré coloré, pour être relues avant validation.
 */
export function GrilleLignes<T>({
  colonnes,
  lignes,
  cle,
  estProposee,
  onSupprimer,
  onDupliquer,
  onDeplacer,
  detail,
  messageVide = 'Aucune ligne pour le moment.',
  libelleTotal = 'Total',
  actions,
  totauxFrais,
}: ProprietesGrille<T>) {
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  // Stable : une ligne mémoïsée ne doit pas rerendre parce que ce rappel a changé d'identité.
  const basculer = useCallback((id: string) => {
    setDeplies((courant) => {
      const suivant = new Set(courant);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }, []);

  const avecTotal = colonnes.some((c) => c.total) || Boolean(totauxFrais);
  const nbColonnes = colonnes.length + 1 + (detail ? 1 : 0);

  return (
    <div>
      <div className="defilement-horizontal">
        {/*
          « avec-detail » dit à la feuille de style que la colonne d'intitulés est la
          deuxième et non la première : c'est elle qui reste figée quand la grille défile
          latéralement, et son décalage dépend de la présence de la colonne de dépliage.
        */}
        <table className={`grille${detail ? ' avec-detail' : ''}`}>
          <thead>
            <tr>
              {detail ? <th style={{ width: 28 }} aria-label="Détail" /> : null}
              {colonnes.map((c) => (
                <th
                  key={c.cle}
                  title={c.aide}
                  style={{
                    minWidth: c.largeur,
                    textAlign: c.alignementGauche ? 'left' : undefined,
                  }}
                >
                  {c.entete}
                </th>
              ))}
              <th style={{ width: 96 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={nbColonnes} className="zone-vide">
                  {messageVide}
                </td>
              </tr>
            ) : null}

            {lignes.map((ligne, index) => {
              const id = cle(ligne);
              return (
                <LigneGrille
                  key={id}
                  ligne={ligne}
                  index={index}
                  dernier={index === lignes.length - 1}
                  ouvert={deplies.has(id)}
                  proposee={estProposee?.(ligne) ?? false}
                  colonnes={colonnes}
                  nbColonnes={nbColonnes}
                  avecChevron={Boolean(detail)}
                  onBasculer={basculer}
                  identifiant={id}
                  detail={detail}
                  onSupprimer={onSupprimer}
                  onDupliquer={onDupliquer}
                  onDeplacer={onDeplacer}
                />
              );
            })}
          </tbody>

          {avecTotal && lignes.length > 0 ? (
            <tfoot>
              <tr>
                {detail ? <td /> : null}
                {colonnes.map((c, i) => (
                  <td
                    key={c.cle}
                    style={{
                      fontWeight: 600,
                      background: 'var(--bleu-clair)',
                      borderTop: '1px solid var(--turquoise)',
                      textAlign: c.alignementGauche ? 'left' : undefined,
                    }}
                  >
                    {i === 0
                      ? libelleTotal
                      : totauxFrais && c.cle in totauxFrais
                        ? formaterMontant(totauxFrais[c.cle])
                        : c.total
                          ? formaterMontant(lignes.reduce((t, l) => t + c.total!(l), 0))
                          : null}
                  </td>
                ))}
                <td style={{ background: 'var(--bleu-clair)', borderTop: '1px solid var(--turquoise)' }} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {actions ? (
        <div className="rangee sans-impression" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Ligne d'un état financier en lecture seule. */
export interface LigneEtat {
  libelle: string;
  valeurs: number[];
  /** total : encadré ; sous-total : gras ; groupe : titre de section ; detail : indenté. */
  style?: 'total' | 'sous-total' | 'groupe' | 'detail';
  /** Colonne supplémentaire, par exemple le pourcentage du chiffre d'affaires. */
  extra?: string[];
  aide?: string;
}

/**
 * Tableau d'état financier.
 *
 * Les lignes nulles sur tous les exercices sont masquées par défaut : un compte de
 * résultat de dossier simple tient alors sur un écran, sans postes inutiles.
 */
export function TableauEtat({
  entetes,
  lignes,
  masquerNuls = true,
  onCopier,
}: {
  entetes: string[];
  lignes: LigneEtat[];
  masquerNuls?: boolean;
  onCopier?: () => void;
}) {
  const [toutAfficher, setToutAfficher] = useState(!masquerNuls);
  const visibles = lignes.filter(
    (l) =>
      toutAfficher ||
      l.style === 'groupe' ||
      l.style === 'total' ||
      l.style === 'sous-total' ||
      l.valeurs.some((v) => Math.round(v) !== 0),
  );

  const copier = () => {
    const texte = [
      entetes.join('\t'),
      ...visibles.map((l) => [l.libelle, ...l.valeurs.map((v) => String(Math.round(v)))].join('\t')),
    ].join('\n');
    void navigator.clipboard?.writeText(texte);
    onCopier?.();
  };

  return (
    <div>
      <div className="rangee espace sans-impression" style={{ marginBottom: 8 }}>
        <button className="bouton discret petit" onClick={() => setToutAfficher((v) => !v)}>
          {toutAfficher ? 'Masquer les postes à zéro' : 'Afficher tous les postes'}
        </button>
        <button className="bouton discret petit" onClick={copier} title="Copier au format tableur">
          Copier
        </button>
      </div>
      <div className="defilement-horizontal">
        <table className="etat">
          <thead>
            <tr>
              {entetes.map((e, i) => (
                <th key={e + i}>{e}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((l, i) => (
              <tr key={`${l.libelle}-${i}`} className={l.style === 'detail' ? undefined : l.style}>
                <td className={l.style === 'detail' ? 'detail' : undefined} title={l.aide}>
                  {l.libelle}
                </td>
                {l.style === 'groupe' ? (
                  <td colSpan={entetes.length - 1} />
                ) : (
                  <>
                    {l.valeurs.map((v, k) => (
                      <td key={k} className={v < 0 ? 'negatif' : undefined}>
                        {Math.round(v) === 0 ? '—' : formaterMontant(v)}
                      </td>
                    ))}
                    {(l.extra ?? []).map((x, k) => (
                      <td key={`x${k}`}>{x}</td>
                    ))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Une ligne de grille, mémoïsée.
 *
 * C'est la pièce qui tient la performance de la saisie. Sans elle, une frappe redessinait les
 * quatre-vingts lignes et les huit cents champs de l'écran alors qu'une seule ligne avait
 * changé — 17,8 ms mesurées sur un dossier de cent soixante lignes, pour un plafond de six.
 *
 * La comparaison est celle de « memo » par défaut, sur l'identité des propriétés, et c'est
 * délibéré : le mode d'échec est alors le bon. Une propriété qu'un écran oublie de stabiliser
 * ne fait pas afficher un chiffre périmé — elle fait seulement rerendre la ligne, comme avant.
 * Une comparaison sur mesure qui ignorerait « colonnes » serait plus rapide et fausse : les
 * fonctions de rendu d'une colonne capturent des valeurs de « resultats », et une capture
 * périmée afficherait un montant qui n'est plus le bon.
 *
 * Ce qui rend la mémoïsation effective : le partage structurel du magasin, qui préserve
 * l'identité d'une ligne non modifiée, et les « useMemo » / « useCallback » des écrans.
 */
interface ProprietesLigne<T> {
  ligne: T;
  index: number;
  dernier: boolean;
  ouvert: boolean;
  proposee: boolean;
  colonnes: Array<Colonne<T>>;
  nbColonnes: number;
  avecChevron: boolean;
  identifiant: string;
  onBasculer: (id: string) => void;
  detail?: (ligne: T) => ReactNode;
  onSupprimer?: (ligne: T) => void;
  onDupliquer?: (ligne: T) => void;
  onDeplacer?: (ligne: T, sens: -1 | 1) => void;
}

function LigneGrilleBrute<T>({
  ligne,
  index,
  dernier,
  ouvert,
  proposee,
  colonnes,
  nbColonnes,
  avecChevron,
  identifiant,
  onBasculer,
  detail,
  onSupprimer,
  onDupliquer,
  onDeplacer,
}: ProprietesLigne<T>) {
  return (
    <>
      <tr className={proposee ? 'ligne-llm' : undefined}>
        {avecChevron ? (
          <td style={{ textAlign: 'center' }}>
            <button
              className="bouton discret petit"
              onClick={() => onBasculer(identifiant)}
              aria-expanded={ouvert}
              title={ouvert ? 'Replier les réglages' : 'Déplier les réglages'}
            >
              {ouvert ? '▾' : '▸'}
            </button>
          </td>
        ) : null}

        {colonnes.map((c) => (
          <td key={c.cle} style={{ textAlign: c.alignementGauche ? 'left' : undefined }}>
            {c.rendu(ligne, index)}
          </td>
        ))}

        <td className="sans-impression">
          <div className="rangee" style={{ justifyContent: 'flex-end', gap: 2 }}>
            {onDeplacer ? (
              <>
                <button
                  className="bouton discret petit"
                  title="Monter"
                  disabled={index === 0}
                  onClick={() => onDeplacer(ligne, -1)}
                >
                  ↑
                </button>
                <button
                  className="bouton discret petit"
                  title="Descendre"
                  disabled={dernier}
                  onClick={() => onDeplacer(ligne, 1)}
                >
                  ↓
                </button>
              </>
            ) : null}
            {onDupliquer ? (
              <button
                className="bouton discret petit"
                title="Dupliquer la ligne"
                onClick={() => onDupliquer(ligne)}
              >
                ⧉
              </button>
            ) : null}
            {onSupprimer ? (
              <button
                className="bouton discret petit danger"
                title="Supprimer la ligne"
                onClick={() => onSupprimer(ligne)}
              >
                ✕
              </button>
            ) : null}
          </div>
        </td>
      </tr>

      {ouvert && detail ? (
        <tr>
          <td colSpan={nbColonnes} style={{ background: 'var(--surface-3)', padding: '12px 16px' }}>
            {detail(ligne)}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// « memo » perd la généricité : on la rétablit par une assertion, seule entorse acceptable ici.
const LigneGrille = memo(LigneGrilleBrute) as typeof LigneGrilleBrute;

import { formaterMontant, LIBELLES_REPARTITION, type Repartition } from '@previs/core';
import { useEffect, useState, type ReactNode } from 'react';
import { ChampMontant, ChampNombre, Selecteur } from './champs.js';

/** Indicateur mis en avant : une valeur, son libellé, et une tonalité. */
export function CarteIndicateur({
  valeur,
  libelle,
  detail,
  ton = 'neutre',
}: {
  valeur: string;
  libelle: string;
  detail?: string;
  ton?: 'neutre' | 'bon' | 'alerte' | 'erreur';
}) {
  const couleur =
    ton === 'bon'
      ? 'var(--succes)'
      : ton === 'alerte'
        ? 'var(--alerte)'
        : ton === 'erreur'
          ? 'var(--erreur)'
          : 'var(--bleu)';
  return (
    <div
      className="carte"
      style={{ padding: '12px 14px', borderTop: `2px solid ${couleur}`, minWidth: 0 }}
    >
      <div
        className="nombres"
        style={{ fontSize: 20, fontWeight: 600, color: couleur, textAlign: 'left' }}
      >
        {valeur}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--texte-doux)', marginTop: 2 }}>{libelle}</div>
      {detail ? (
        <div style={{ fontSize: 11, color: 'var(--texte-faible)', marginTop: 3 }}>{detail}</div>
      ) : null}
    </div>
  );
}

export function Bandeau({
  ton = 'info',
  children,
  action,
}: {
  ton?: 'info' | 'succes' | 'alerte' | 'erreur' | 'llm';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`bandeau-info ${ton === 'info' ? '' : ton}`}>
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function ZoneVide({ titre, children }: { titre: string; children?: ReactNode }) {
  return (
    <div className="zone-vide">
      <div style={{ fontWeight: 500, color: 'var(--texte-doux)', marginBottom: 4 }}>{titre}</div>
      {children}
    </div>
  );
}

export function Chargement({ texte = 'Chargement…' }: { texte?: string }) {
  return <div className="zone-vide">{texte}</div>;
}

/** Fenêtre modale simple, refermable par Échap ou par le fond. */
export function Modale({
  titre,
  onFermer,
  children,
  actions,
  largeur = 520,
}: {
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  actions?: ReactNode;
  largeur?: number;
}) {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer]);

  return (
    <div
      role="presentation"
      onClick={onFermer}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12, 16, 28, 0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        onClick={(e) => e.stopPropagation()}
        className="carte"
        style={{ width: largeur, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--ombre-forte)' }}
      >
        <header>
          <h2>{titre}</h2>
          <button className="bouton discret" onClick={onFermer} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="corps">{children}</div>
        {actions ? (
          <div
            className="rangee"
            style={{ justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--trait)' }}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Demande de confirmation avant une action irréversible. */
export function Confirmation({
  titre,
  message,
  libelleAction = 'Confirmer',
  onConfirmer,
  onAnnuler,
}: {
  titre: string;
  message: string;
  libelleAction?: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  return (
    <Modale
      titre={titre}
      onFermer={onAnnuler}
      largeur={420}
      actions={
        <>
          <button className="bouton" onClick={onAnnuler}>
            Annuler
          </button>
          <button className="bouton principal danger" onClick={onConfirmer}>
            {libelleAction}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modale>
  );
}

/**
 * Éditeur de clé de répartition mensuelle.
 *
 * La saisonnalité se règle par douze poids relatifs, avec un aperçu en barres : c'est
 * ce qui permet de traduire une activité saisonnière sans saisir douze montants.
 */
export function RepartitionMensuelle({
  valeur,
  onChange,
  nbExercices,
}: {
  valeur: Repartition;
  onChange: (v: Repartition) => void;
  nbExercices: number;
}) {
  const types = Object.entries(LIBELLES_REPARTITION).map(([v, libelle]) => ({
    valeur: v as Repartition['type'],
    libelle,
  }));

  const changerType = (type: Repartition['type']) => {
    switch (type) {
      case 'lineaire':
        return onChange({ type: 'lineaire' });
      case 'ponctuel':
        return onChange({ type: 'ponctuel', mois: 1 });
      case 'demarrage':
        return onChange({ type: 'demarrage', moisDebut: 1 });
      case 'saisonnalite':
        return onChange({ type: 'saisonnalite', poids: Array.from({ length: 12 }, () => 1) });
      case 'mensuel':
        return onChange({
          type: 'mensuel',
          montants: Array.from({ length: nbExercices }, () => Array.from({ length: 12 }, () => 0)),
        });
    }
  };

  const maxPoids =
    valeur.type === 'saisonnalite' ? Math.max(1, ...valeur.poids.map((p) => p || 0)) : 1;

  return (
    <div className="pile" style={{ gap: 10 }}>
      <Selecteur
        libelle="Répartition sur les mois de l’exercice"
        valeur={valeur.type}
        onChange={changerType}
        options={types}
      />

      {valeur.type === 'ponctuel' ? (
        <ChampNombre
          libelle="Mois de l’exercice"
          valeur={valeur.mois}
          min={1}
          max={24}
          onChange={(mois) => onChange({ type: 'ponctuel', mois })}
          aide="1 correspond au premier mois de l’exercice, pas au mois de janvier."
        />
      ) : null}

      {valeur.type === 'demarrage' ? (
        <ChampNombre
          libelle="À partir du mois"
          valeur={valeur.moisDebut}
          min={1}
          max={24}
          onChange={(moisDebut) => onChange({ type: 'demarrage', moisDebut })}
          aide="Le montant est réparti également des mois restants jusqu’à la clôture."
        />
      ) : null}

      {valeur.type === 'saisonnalite' ? (
        <div>
          <label className="libelle">Poids relatifs des douze mois</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
            {valeur.poids.map((poids, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div
                  aria-hidden
                  style={{
                    height: 34,
                    display: 'flex',
                    alignItems: 'flex-end',
                    background: 'var(--surface-2)',
                    borderRadius: 3,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: `${Math.max(3, ((poids || 0) / maxPoids) * 100)}%`,
                      background: 'var(--turquoise)',
                      borderRadius: 3,
                    }}
                  />
                </div>
                <input
                  className="champ nombre"
                  style={{ padding: '2px 3px', fontSize: 11 }}
                  type="number"
                  min={0}
                  value={poids}
                  aria-label={`Poids du mois ${i + 1}`}
                  onChange={(e) => {
                    const poidsSuivants = [...valeur.poids];
                    poidsSuivants[i] = Number(e.target.value);
                    onChange({ type: 'saisonnalite', poids: poidsSuivants });
                  }}
                />
              </div>
            ))}
          </div>
          <div className="aide-champ">
            Les poids sont relatifs : « 2 » sur un mois lui donne deux fois la part d’un mois à « 1 ».
          </div>
        </div>
      ) : null}

      {valeur.type === 'mensuel' ? (
        <div className="pile" style={{ gap: 8 }}>
          {Array.from({ length: nbExercices }, (_, exercice) => (
            <div key={exercice}>
              <label className="libelle">Exercice {exercice + 1}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                {Array.from({ length: 12 }, (_, mois) => (
                  <ChampMontant
                    key={mois}
                    valeur={valeur.montants[exercice]?.[mois] ?? 0}
                    onChange={(montant) => {
                      const grille = valeur.montants.map((l) => [...(l ?? [])]);
                      while (grille.length < nbExercices) grille.push([]);
                      grille[exercice] = grille[exercice] ?? [];
                      grille[exercice][mois] = montant;
                      onChange({ type: 'mensuel', montants: grille });
                    }}
                    titre={`Mois ${mois + 1}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="aide-champ">
            En saisie mensuelle détaillée, ces montants remplacent le total annuel de la ligne.
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Petit graphique en barres ou en courbe, tracé en SVG sans dépendance. */
export function Graphique({
  type,
  libelles,
  series,
  hauteur = 180,
  formater = formaterMontant,
}: {
  type: 'barres' | 'courbe';
  libelles: string[];
  series: Array<{ nom: string; valeurs: number[]; couleur?: string }>;
  hauteur?: number;
  formater?: (v: number) => string;
}) {
  const [survol, setSurvol] = useState<number | null>(null);
  const largeur = 720;
  const marge = { haut: 10, droite: 8, bas: 30, gauche: 62 };
  const aireL = largeur - marge.gauche - marge.droite;
  const aireH = hauteur - marge.haut - marge.bas;

  const toutes = series.flatMap((s) => s.valeurs);
  if (toutes.length === 0) return null;
  const max = Math.max(0, ...toutes);
  const min = Math.min(0, ...toutes);
  const amplitude = max - min || 1;
  const y = (v: number) => marge.haut + aireH - ((v - min) / amplitude) * aireH;
  const couleurs = ['var(--turquoise)', 'var(--bleu)', 'var(--succes)', 'var(--alerte)'];

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} width="100%" height={hauteur} role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const valeur = min + amplitude * f;
          return (
            <g key={f}>
              <line
                x1={marge.gauche}
                x2={largeur - marge.droite}
                y1={y(valeur)}
                y2={y(valeur)}
                stroke="var(--trait)"
                strokeDasharray={Math.abs(valeur) < 1e-9 ? undefined : '2 3'}
              />
              <text x={marge.gauche - 6} y={y(valeur) + 3.5} textAnchor="end" fontSize="10" fill="var(--texte-faible)">
                {formater(valeur)}
              </text>
            </g>
          );
        })}

        {type === 'barres'
          ? libelles.map((_, i) => {
              const largeurGroupe = aireL / libelles.length;
              // Avec de nombreuses séries, la largeur calculée pouvait devenir
              // négative et rendre le graphique invalide : elle est bornée.
              const largeurBarre = Math.max(
                1.5,
                Math.min(46, (largeurGroupe * 0.72) / series.length),
              );
              const centre = marge.gauche + largeurGroupe * (i + 0.5);
              return (
                <g key={i} onMouseEnter={() => setSurvol(i)} onMouseLeave={() => setSurvol(null)}>
                  {series.map((s, k) => {
                    const v = s.valeurs[i] ?? 0;
                    const haut = Math.min(y(v), y(0));
                    const bas = Math.max(y(v), y(0));
                    return (
                      <rect
                        key={k}
                        x={centre - (largeurBarre * series.length) / 2 + k * largeurBarre}
                        y={haut}
                        width={Math.max(1, largeurBarre - 1.5)}
                        height={Math.max(1, bas - haut)}
                        fill={s.couleur ?? couleurs[k % couleurs.length]}
                        opacity={survol === null || survol === i ? 1 : 0.45}
                      />
                    );
                  })}
                </g>
              );
            })
          : series.map((s, k) => (
              <path
                key={k}
                d={s.valeurs
                  .map(
                    (v, i) =>
                      `${i === 0 ? 'M' : 'L'} ${marge.gauche + (i / Math.max(s.valeurs.length - 1, 1)) * aireL} ${y(v)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={s.couleur ?? couleurs[k % couleurs.length]}
                strokeWidth={1.8}
              />
            ))}

        {libelles.map((libelle, i) => {
          const pas = Math.max(1, Math.ceil(libelles.length / 12));
          if (i % pas !== 0) return null;
          const x =
            type === 'barres'
              ? marge.gauche + (aireL / libelles.length) * (i + 0.5)
              : marge.gauche + (i / Math.max(libelles.length - 1, 1)) * aireL;
          return (
            <text key={i} x={x} y={hauteur - 10} textAnchor="middle" fontSize="10" fill="var(--texte-faible)">
              {libelle}
            </text>
          );
        })}
      </svg>

      <div className="rangee" style={{ gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--texte-doux)' }}>
        {series.map((s, k) => (
          <span key={s.nom} className="rangee" style={{ gap: 5 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: s.couleur ?? couleurs[k % couleurs.length],
              }}
            />
            {s.nom}
            {survol !== null ? ` : ${formater(s.valeurs[survol] ?? 0)}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

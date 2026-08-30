import { LOGO_MAX_CARACTERES, TYPES_LOGO } from '@previs/core';
import { useRef, useState } from 'react';

/** Largeurs successivement tentées pour tenir sous le plafond du serveur. */
const LARGEURS = [600, 420, 300];

/**
 * Redimensionne et réencode une image avant l'envoi.
 *
 * Une photo de logo sortie d'un téléphone pèse plusieurs mégaoctets : la réduire dans
 * le navigateur évite de transporter puis de conserver dix fois la taille utile. Le
 * PNG est préservé pour garder la transparence ; un JPEG le reste, car le convertir
 * en PNG grossirait le fichier sans rien apporter.
 */
async function preparer(fichier: File): Promise<{ logo: string } | { erreur: string }> {
  if (!(TYPES_LOGO as readonly string[]).includes(fichier.type)) {
    return { erreur: 'Format non accepté. Déposer un PNG, un JPEG ou un WebP.' };
  }

  const source = await new Promise<string>((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result));
    lecteur.onerror = () => rejeter(new Error('Lecture du fichier impossible.'));
    lecteur.readAsDataURL(fichier);
  });

  const image = await new Promise<HTMLImageElement | null>((resoudre) => {
    const img = new Image();
    img.onload = () => resoudre(img);
    img.onerror = () => resoudre(null);
    img.src = source;
  });
  if (!image) return { erreur: 'Ce fichier n’est pas une image lisible.' };

  const type = fichier.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  if (source.length <= LOGO_MAX_CARACTERES && image.naturalWidth <= LARGEURS[0]) {
    return { logo: source };
  }

  for (const largeur of LARGEURS) {
    const echelle = Math.min(1, largeur / image.naturalWidth);
    const toile = document.createElement('canvas');
    toile.width = Math.max(1, Math.round(image.naturalWidth * echelle));
    toile.height = Math.max(1, Math.round(image.naturalHeight * echelle));
    const contexte = toile.getContext('2d');
    if (!contexte) return { erreur: 'Le navigateur n’a pas pu traiter l’image.' };
    contexte.drawImage(image, 0, 0, toile.width, toile.height);
    const reduit = toile.toDataURL(type, 0.92);
    if (reduit.length <= LOGO_MAX_CARACTERES) return { logo: reduit };
  }

  return { erreur: 'Image trop lourde même réduite. Déposer un logo plus simple.' };
}

interface Proprietes {
  logo: string;
  onChange: (logo: string) => void;
  libelle: string;
  aide?: string;
  /** Hauteur de l'aperçu, en pixels. */
  hauteur?: number;
  desactive?: boolean;
}

/** Dépôt, aperçu et retrait d'un logo. */
export function ChampLogo({ logo, onChange, libelle, aide, hauteur = 64, desactive }: Proprietes) {
  const entree = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const choisir = async (fichier: File | undefined) => {
    if (!fichier) return;
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await preparer(fichier);
      if ('erreur' in resultat) setErreur(resultat.erreur);
      else onChange(resultat.logo);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Dépôt impossible.');
    } finally {
      setEnCours(false);
      if (entree.current) entree.current.value = '';
    }
  };

  return (
    <div>
      <label className="libelle">{libelle}</label>
      <div className="rangee" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: hauteur * 2.4,
            height: hauteur,
            border: '1px dashed var(--trait)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            background: '#fff',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {logo ? (
            // `object-fit` plutôt qu'un simple maximum : un logo carré comme un logo
            // en bandeau doivent tous deux tenir entiers dans le même cadre.
            <img
              src={logo}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <span className="discret" style={{ fontSize: 11 }}>
              aucun logo
            </span>
          )}
        </div>
        <div className="pile" style={{ gap: 6 }}>
          <div className="rangee" style={{ gap: 8 }}>
            <button
              type="button"
              className="bouton"
              disabled={desactive || enCours}
              onClick={() => entree.current?.click()}
            >
              {enCours ? 'Traitement…' : logo ? 'Remplacer' : 'Déposer un logo'}
            </button>
            {logo ? (
              <button
                type="button"
                className="bouton discret"
                disabled={desactive || enCours}
                onClick={() => {
                  setErreur(null);
                  onChange('');
                }}
              >
                Retirer
              </button>
            ) : null}
          </div>
          {aide ? <div className="aide-champ">{aide}</div> : null}
          {erreur ? (
            <div className="aide-champ" style={{ color: 'var(--erreur)' }}>
              {erreur}
            </div>
          ) : null}
        </div>
      </div>
      <input
        ref={entree}
        type="file"
        accept={TYPES_LOGO.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => void choisir(e.target.files?.[0])}
      />
    </div>
  );
}

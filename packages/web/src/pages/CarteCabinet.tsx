import type { Cabinet } from '@previs/core';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ChampTexte } from '../ui/champs.js';
import { Bandeau, Chargement } from '../ui/divers.js';
import { ChampLogo } from '../ui/logo.js';

/**
 * Identité du cabinet, reprise sur la page de garde, les bandeaux et le pied de
 * chaque dossier remis. Rien n'est écrit en dur dans le logiciel : ce qui est saisi
 * ici est ce qui s'imprime.
 */
export function CarteCabinet() {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [initial, setInitial] = useState<Cabinet | null>(null);
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'enregistre'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const c = await api.lireCabinet();
        setCabinet(c);
        setInitial(c);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : 'Chargement de l’identité du cabinet impossible.');
      }
    })();
  }, []);

  if (erreur && !cabinet) return <Bandeau ton="erreur">{erreur}</Bandeau>;
  if (!cabinet) return <Chargement />;

  const modifie = JSON.stringify(cabinet) !== JSON.stringify(initial);
  const poser = <C extends keyof Cabinet>(champ: C, valeur: Cabinet[C]) => {
    setEtat('repos');
    setCabinet({ ...cabinet, [champ]: valeur });
  };
  const poserAdresse = (champ: keyof Cabinet['adresse'], valeur: string) => {
    setEtat('repos');
    setCabinet({ ...cabinet, adresse: { ...cabinet.adresse, [champ]: valeur } });
  };

  const enregistrer = async () => {
    setEtat('envoi');
    setErreur(null);
    try {
      const enregistre = await api.enregistrerCabinet(cabinet);
      setCabinet(enregistre);
      setInitial(enregistre);
      setEtat('enregistre');
    } catch (e) {
      setEtat('repos');
      setErreur(e instanceof Error ? e.message : 'Enregistrement impossible.');
    }
  };

  return (
    <section className="carte">
      <header>
        <div>
          <h2>Identité du cabinet</h2>
          <div className="discret">
            Ce qui figure ici s’imprime sur la page de garde, dans le bandeau de chaque page et sur la
            dernière page de tous les dossiers remis.
          </div>
        </div>
        <div className="rangee" style={{ gap: 8 }}>
          {etat === 'enregistre' && !modifie ? <span className="discret">Enregistré</span> : null}
          <button
            className="bouton principal"
            disabled={!modifie || etat === 'envoi'}
            onClick={() => void enregistrer()}
          >
            {etat === 'envoi' ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </header>

      <div className="corps pile">
        {erreur ? <Bandeau ton="erreur">{erreur}</Bandeau> : null}

        <ChampLogo
          libelle="Logo du cabinet"
          aide="PNG, JPEG ou WebP. Il est posé sur un cartouche blanc sur la page de garde et la dernière page."
          hauteur={72}
          logo={cabinet.logo}
          onChange={(logo) => poser('logo', logo)}
        />

        <div className="grille-champs">
          <ChampTexte
            libelle="Raison sociale"
            valeur={cabinet.nom}
            onChange={(v) => poser('nom', v)}
            longueurMax={200}
          />
          <ChampTexte
            libelle="Qualité"
            aide="Mention portée sous le nom, par exemple « Cabinet d’expertise comptable »."
            valeur={cabinet.qualite}
            onChange={(v) => poser('qualite', v)}
            longueurMax={150}
          />
          <ChampTexte
            libelle="Expert-comptable signataire"
            valeur={cabinet.expertComptable}
            onChange={(v) => poser('expertComptable', v)}
            longueurMax={150}
          />
          <ChampTexte
            libelle="Forme juridique"
            valeur={cabinet.formeJuridique}
            onChange={(v) => poser('formeJuridique', v)}
            longueurMax={80}
          />
          <ChampTexte
            libelle="Capital social"
            placeholder="10 000 €"
            valeur={cabinet.capital}
            onChange={(v) => poser('capital', v)}
            longueurMax={60}
          />
          <ChampTexte
            libelle="SIRET"
            valeur={cabinet.siret}
            onChange={(v) => poser('siret', v)}
            longueurMax={20}
          />
          <ChampTexte
            libelle="TVA intracommunautaire"
            placeholder="FR00000000000"
            valeur={cabinet.numeroTva}
            onChange={(v) => poser('numeroTva', v)}
            longueurMax={20}
          />
          <ChampTexte
            libelle="Inscription à l’Ordre"
            aide="Mention obligatoire sur les documents du cabinet."
            placeholder="Inscrit au tableau de l’Ordre des experts-comptables de la région Occitanie"
            valeur={cabinet.inscriptionOrdre}
            onChange={(v) => poser('inscriptionOrdre', v)}
            longueurMax={200}
          />
        </div>

        <div className="grille-champs">
          <ChampTexte
            libelle="Adresse"
            valeur={cabinet.adresse.voie}
            onChange={(v) => poserAdresse('voie', v)}
            longueurMax={200}
          />
          <ChampTexte
            libelle="Complément d’adresse"
            valeur={cabinet.adresse.complement}
            onChange={(v) => poserAdresse('complement', v)}
            longueurMax={200}
          />
          <ChampTexte
            libelle="Code postal"
            valeur={cabinet.adresse.codePostal}
            onChange={(v) => poserAdresse('codePostal', v)}
            longueurMax={10}
          />
          <ChampTexte
            libelle="Ville"
            valeur={cabinet.adresse.ville}
            onChange={(v) => poserAdresse('ville', v)}
            longueurMax={120}
          />
          <ChampTexte
            libelle="Téléphone"
            valeur={cabinet.telephone}
            onChange={(v) => poser('telephone', v)}
            longueurMax={30}
          />
          <ChampTexte
            libelle="Adresse électronique"
            valeur={cabinet.courriel}
            onChange={(v) => poser('courriel', v)}
            longueurMax={150}
          />
          <ChampTexte
            libelle="Site internet"
            valeur={cabinet.site}
            onChange={(v) => poser('site', v)}
            longueurMax={150}
          />
        </div>

        <div>
          <label className="libelle">Avertissement de fin de dossier</label>
          <textarea
            className="champ"
            rows={4}
            maxLength={2000}
            value={cabinet.mentionLegale}
            onChange={(e) => poser('mentionLegale', e.target.value)}
          />
          <div className="aide-champ">
            Reproduit sur la dernière page, sous les coordonnées du cabinet.
          </div>
        </div>
      </div>
    </section>
  );
}

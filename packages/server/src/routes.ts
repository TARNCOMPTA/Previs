import {
  ENTETE_JETON,
  ErreurDepot,
  zRequeteConnexion,
  zRequeteCreation,
  zRequeteEnregistrement,
  zRequeteCabinet,
  zRequeteJeton,
  zRequeteLogo,
  zRequetePatch,
  zRequeteUtilisateur,
  type JetonApi,
} from '@previs/core';
// L'import du greffon apporte l'augmentation de type qui expose setCookie et clearCookie.
import '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auteurDe, exiger, identifier, NOM_COOKIE, type ServiceAuthentification } from './auth.js';
import { journaliser, type BaseDonnees } from './base.js';
import { verifierLogo, type ServiceCabinet } from './cabinet.js';
import type { DepotSqlite } from './depot.js';
import type { Configuration } from './config.js';
import {
  empreinteJeton,
  LimiteurConnexions,
  LimiteurDebit,
  nouveauJeton,
  nouvelIdentifiant,
} from './securite.js';

interface Contexte {
  base: BaseDonnees;
  auth: ServiceAuthentification;
  depot: DepotSqlite;
  cabinet: ServiceCabinet;
  config: Configuration;
}

/** Convertit une erreur métier du dépôt en réponse HTTP conforme au contrat. */
function repondreErreur(
  erreur: unknown,
  reponse: import('fastify').FastifyReply,
  production = true,
): void {
  if (erreur instanceof ErreurDepot) {
    const codes: Record<string, number> = {
      introuvable: 404,
      conflit_version: 409,
      donnees_invalides: 422,
      interdit: 403,
      erreur_interne: 500,
    };
    reponse
      .code(codes[erreur.code] ?? 500)
      .send({ erreur: erreur.message, code: erreur.code, details: erreur.details });
    return;
  }
  if (erreur instanceof z.ZodError) {
    reponse.code(422).send({
      erreur: 'Les données transmises ne respectent pas le format attendu.',
      code: 'donnees_invalides',
      details: erreur.issues,
    });
    return;
  }
  // Le message d'une erreur non prévue peut porter un chemin de fichier ou un
  // fragment de requête SQL : il reste dans le journal, jamais dans la réponse.
  reponse.log.error(erreur);
  reponse.code(500).send({
    erreur: production
      ? 'Une erreur interne est survenue. Le détail figure dans le journal du serveur.'
      : erreur instanceof Error
        ? erreur.message
        : 'Erreur interne.',
    code: 'erreur_interne',
  });
}

/**
 * Vérifie l'origine des requêtes qui modifient l'état et s'authentifient par cookie.
 *
 * Le cookie de session est déjà en `SameSite=lax`, ce qui écarte l'essentiel des
 * requêtes intersites. Ce contrôle ajoute la seconde barrière : un navigateur envoie
 * toujours `Origin` sur une méthode autre que GET, y compris pour un formulaire
 * soumis depuis une page tierce. Les appels par jeton d'API, eux, ne sont pas
 * exposés à ce risque — un en-tête personnalisé ne se forge pas depuis une page.
 */
function verifierOrigine(app: FastifyInstance, config: Configuration): void {
  const autorisees = new Set<string>();
  try {
    autorisees.add(new URL(config.urlPublique).origin);
  } catch {
    // PUBLIC_URL mal formée : on s'appuie alors sur la seule comparaison à l'hôte.
  }
  for (const brute of (process.env.ORIGINES_AUTORISEES ?? '').split(',')) {
    const nette = brute.trim();
    if (nette) autorisees.add(nette);
  }

  const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

  app.addHook('onRequest', async (requete, reponse) => {
    if (METHODES_SURES.has(requete.method)) return;
    if (requete.headers[ENTETE_JETON]) return;

    const cookies = (requete as typeof requete & { cookies?: Record<string, string> }).cookies;
    if (!cookies?.[NOM_COOKIE]) return;

    const origine = requete.headers.origin;
    if (!origine) {
      return reponse
        .code(403)
        .send({ erreur: 'En-tête Origin absent sur une requête authentifiée par session.', code: 'interdit' });
    }
    if (autorisees.has(origine)) return;
    // Même origine que la requête : le cas normal quand PUBLIC_URL n'est pas renseignée.
    if (requete.headers.host && origine.endsWith(`//${requete.headers.host}`)) return;
    if (!config.production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine)) return;

    return reponse
      .code(403)
      .send({ erreur: 'Origine de la requête non autorisée.', code: 'interdit' });
  });
}

export function enregistrerRoutes(app: FastifyInstance, ctx: Contexte): void {
  verifierOrigine(app, ctx.config);

  // Deux compteurs distincts : l'un arrête un poste qui essaie des mots de passe en
  // série, l'autre un essai réparti sur plusieurs adresses contre un même compte.
  // Le second est plus large, pour qu'un tiers ne puisse pas bloquer un collaborateur.
  const parAdresse = new LimiteurConnexions(10, 15 * 60 * 1000);
  const parCompte = new LimiteurConnexions(20, 60 * 60 * 1000);
  // Un export lance un rendu Chromium : trente par quart d'heure et par compte.
  const debitPdf = new LimiteurDebit(30, 15 * 60 * 1000);

  // ─── État du service ────────────────────────────────────────────────────────
  // Route publique : elle sert à la surveillance du service et ne doit donc rien
  // révéler du contenu — ni le nombre de dossiers, ni celui des comptes.
  app.get('/api/sante', async () => ({ service: 'previs', etat: 'operationnel' }));

  // ─── Authentification ───────────────────────────────────────────────────────
  app.post('/api/auth/connexion', async (requete, reponse) => {
    const adresse = requete.ip;
    let compte = '';
    try {
      const { email, motDePasse } = zRequeteConnexion.parse(requete.body);
      compte = email.toLowerCase().trim();
      if (parAdresse.bloque(adresse) || parCompte.bloque(compte)) {
        return reponse.code(429).send({
          erreur: 'Trop de tentatives de connexion. Réessayer dans quelques minutes.',
          code: 'interdit',
        });
      }
      const resultat = await ctx.auth.connecter(email, motDePasse);
      if (!resultat) {
        parAdresse.echec(adresse);
        parCompte.echec(compte);
        journaliser(ctx.base, {
          utilisateur: compte,
          origine: 'interface',
          action: 'connexion_refusee',
          detail: adresse,
        });
        return reponse
          .code(401)
          .send({ erreur: 'Adresse ou mot de passe incorrect.', code: 'non_authentifie' });
      }
      parAdresse.succes(adresse);
      parCompte.succes(compte);
      reponse.setCookie(NOM_COOKIE, resultat.session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.config.cookiesSecurises,
        path: '/',
        maxAge: 30 * 86400,
      });
      journaliser(ctx.base, {
        utilisateur: resultat.utilisateur.nom,
        origine: 'interface',
        action: 'connexion',
      });
      return { utilisateur: resultat.utilisateur };
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.post('/api/auth/deconnexion', async (requete, reponse) => {
    const cookies = (requete as typeof requete & { cookies?: Record<string, string> }).cookies;
    const session = cookies?.[NOM_COOKIE];
    if (session) ctx.auth.deconnecter(session);
    reponse.clearCookie(NOM_COOKIE, { path: '/' });
    return { deconnecte: true };
  });

  app.get('/api/auth/moi', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    return { utilisateur: identite.utilisateur, origine: identite.origine };
  });

  app.post('/api/auth/motdepasse', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { ancien, nouveau } = z
        .object({ ancien: z.string().min(1), nouveau: z.string().min(10).max(200) })
        .parse(requete.body);

      // Même plafond que la connexion : sans lui, une session volée permettrait
      // d'essayer le mot de passe actuel sans limite pour s'approprier le compte.
      const cle = `motdepasse:${identite.utilisateur.id}`;
      if (parCompte.bloque(cle)) {
        return reponse.code(429).send({
          erreur: 'Trop de tentatives. Réessayer dans quelques minutes.',
          code: 'interdit',
        });
      }
      const verifie = await ctx.auth.verifierIdentifiants(identite.utilisateur.email, ancien);
      if (!verifie) {
        parCompte.echec(cle);
        return reponse
          .code(401)
          .send({ erreur: 'Le mot de passe actuel est incorrect.', code: 'non_authentifie' });
      }
      parCompte.succes(cle);
      await ctx.auth.changerMotDePasse(identite.utilisateur.id, nouveau);
      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: identite.origine,
        action: 'changement_mot_de_passe',
        cible: identite.utilisateur.id,
      });
      reponse.clearCookie(NOM_COOKIE, { path: '/' });
      return { modifie: true };
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  // ─── Dossiers ───────────────────────────────────────────────────────────────
  app.get('/api/dossiers', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    return ctx.depot.lister();
  });

  app.post('/api/dossiers', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      return await ctx.depot.creer(zRequeteCreation.parse(requete.body), auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.get('/api/dossiers/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    const { id } = requete.params as { id: string };
    const dossier = await ctx.depot.lire(id);
    if (!dossier) {
      return reponse.code(404).send({ erreur: 'Dossier introuvable.', code: 'introuvable' });
    }
    return dossier;
  });

  app.put('/api/dossiers/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.enregistrer(
        id,
        zRequeteEnregistrement.parse(requete.body),
        auteurDe(identite),
      );
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.patch('/api/dossiers/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.appliquer(id, zRequetePatch.parse(requete.body), auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.delete('/api/dossiers/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      await ctx.depot.supprimer(id);
      return { supprime: true };
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.post('/api/dossiers/:id/dupliquer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.dupliquer(id, auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.get('/api/dossiers/:id/versions', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.versions(id);
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.get('/api/dossiers/:id/versions/:version', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id, version } = requete.params as { id: string; version: string };
      const archive = await ctx.depot.lireVersion(id, Number(version));
      if (!archive) {
        return reponse.code(404).send({ erreur: 'Version introuvable.', code: 'introuvable' });
      }
      return archive;
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.post('/api/dossiers/:id/versions/:version/restaurer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id, version } = requete.params as { id: string; version: string };
      return await ctx.depot.restaurer(id, Number(version), auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.post('/api/dossiers/:id/calculer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.calculer(id);
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.post('/api/dossiers/:id/pdf', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    if (!debitPdf.autoriser(identite.utilisateur.id)) {
      return reponse.code(429).send({
        erreur: 'Trop d’exports demandés. Patienter quelques minutes.',
        code: 'interdit',
      });
    }
    try {
      const { id } = requete.params as { id: string };
      const enregistre = await ctx.depot.lire(id);
      if (!enregistre) {
        return reponse.code(404).send({ erreur: 'Dossier introuvable.', code: 'introuvable' });
      }
      const pdf = await ctx.depot.pdf(id);
      // Le nom vient du dossier : tout ce qui n'est pas alphanumérique est remplacé,
      // pour qu'aucun guillemet ni saut de ligne ne s'échappe de l'en-tête HTTP.
      const nomFichier = `${(enregistre.client || enregistre.nom)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'Dossier'}-${enregistre.anneeDebut.replace(/[^0-9]/g, '')}-Previsionnel.pdf`;
      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: identite.origine,
        action: 'export_pdf',
        cible: id,
      });
      return reponse
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${nomFichier}"`)
        .send(Buffer.from(pdf));
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  // ─── Identité du cabinet ────────────────────────────────────────────────────
  // Lecture ouverte à tout compte : l'interface l'affiche et le PDF s'en sert.
  // L'écriture reste réservée aux administrateurs.
  app.get('/api/cabinet', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    return ctx.cabinet.lire();
  });

  app.put('/api/cabinet', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    try {
      const modifications = zRequeteCabinet.parse(requete.body);
      if (modifications.logo !== undefined) {
        const controle = verifierLogo(modifications.logo);
        if (!controle.ok) {
          return reponse.code(422).send({ erreur: controle.raison, code: 'donnees_invalides' });
        }
      }
      const cabinet = ctx.cabinet.enregistrer(modifications);
      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: 'interface',
        action: 'modification_cabinet',
        detail: Object.keys(modifications).join(', '),
      });
      return cabinet;
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  // ─── Logo d'un dossier client ───────────────────────────────────────────────
  app.put('/api/dossiers/:id/logo', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      const { logo } = zRequeteLogo.parse(requete.body);
      const controle = verifierLogo(logo);
      if (!controle.ok) {
        return reponse.code(422).send({ erreur: controle.raison, code: 'donnees_invalides' });
      }
      return await ctx.depot.definirLogo(id, logo);
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  // ─── Jetons d'API pour le serveur MCP ───────────────────────────────────────
  app.get('/api/jetons', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    const lignes = ctx.base
      .prepare('SELECT id, libelle, apercu, cree_le, expire_le, derniere_utilisation FROM jetons ORDER BY cree_le DESC')
      .all() as Array<{
      id: string;
      libelle: string;
      apercu: string;
      cree_le: string;
      expire_le: string | null;
      derniere_utilisation: string | null;
    }>;
    return lignes.map(
      (l): JetonApi => ({
        id: l.id,
        libelle: l.libelle,
        apercu: l.apercu,
        creeLe: l.cree_le,
        expireLe: l.expire_le,
        derniereUtilisation: l.derniere_utilisation,
      }),
    );
  });

  app.post('/api/jetons', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    try {
      const { libelle, validiteJours } = zRequeteJeton.parse(requete.body);
      const jeton = nouveauJeton();
      const id = nouvelIdentifiant('jet');
      const expiration =
        validiteJours > 0
          ? new Date(Date.now() + validiteJours * 86400000).toISOString()
          : null;

      ctx.base
        .prepare(
          `INSERT INTO jetons (id, libelle, empreinte, apercu, utilisateur_id, cree_le, expire_le)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          libelle,
          empreinteJeton(jeton),
          jeton.slice(-4),
          identite.utilisateur.id,
          new Date().toISOString(),
          expiration,
        );

      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: 'interface',
        action: 'creation_jeton',
        cible: id,
        detail: libelle,
      });

      // Le jeton en clair n'est renvoyé qu'ici : seule son empreinte est conservée.
      return { id, libelle, jeton, expireLe: expiration };
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.delete('/api/jetons/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    const { id } = requete.params as { id: string };
    ctx.base.prepare('DELETE FROM jetons WHERE id = ?').run(id);
    journaliser(ctx.base, {
      utilisateur: identite.utilisateur.nom,
      origine: 'interface',
      action: 'suppression_jeton',
      cible: id,
    });
    return { supprime: true };
  });

  // ─── Comptes ────────────────────────────────────────────────────────────────
  app.get('/api/utilisateurs', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    return ctx.auth.listerUtilisateurs();
  });

  app.post('/api/utilisateurs', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    try {
      const entree = zRequeteUtilisateur.parse(requete.body);
      const utilisateur = await ctx.auth.creerUtilisateur(entree);
      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: 'interface',
        action: 'creation_compte',
        cible: utilisateur.id,
        detail: utilisateur.email,
      });
      return utilisateur;
    } catch (erreur) {
      if (erreur instanceof Error && erreur.message.includes('UNIQUE')) {
        return reponse.code(422).send({
          erreur: 'Un compte utilise déjà cette adresse électronique.',
          code: 'donnees_invalides',
        });
      }
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.patch('/api/utilisateurs/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    try {
      const { id } = requete.params as { id: string };
      const entree = z
        .object({
          nom: z.string().min(1).max(150).optional(),
          role: z.enum(['admin', 'collaborateur', 'lecteur']).optional(),
          actif: z.boolean().optional(),
          motDePasse: z.string().min(10).max(200).optional(),
        })
        .parse(requete.body);

      const cible = ctx.auth.lireUtilisateur(id);
      if (!cible) {
        return reponse.code(404).send({ erreur: 'Compte introuvable.', code: 'introuvable' });
      }

      // Rétrograder ou désactiver le dernier administrateur rendrait la gestion des
      // comptes et des jetons définitivement inaccessible.
      const perdSonRole = entree.role !== undefined && entree.role !== 'admin';
      const estDesactive = entree.actif === false;
      if (
        cible.role === 'admin' &&
        cible.actif &&
        (perdSonRole || estDesactive) &&
        ctx.auth.compterAdministrateurs() <= 1
      ) {
        return reponse.code(422).send({
          erreur: 'Ce compte est le dernier administrateur actif : nommer un autre administrateur avant de le modifier.',
          code: 'donnees_invalides',
        });
      }

      if (entree.nom !== undefined) {
        ctx.base.prepare('UPDATE utilisateurs SET nom = ? WHERE id = ?').run(entree.nom, id);
      }
      if (entree.role !== undefined) {
        ctx.base.prepare('UPDATE utilisateurs SET role = ? WHERE id = ?').run(entree.role, id);
      }
      if (entree.actif !== undefined) {
        ctx.base
          .prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?')
          .run(entree.actif ? 1 : 0, id);
        if (!entree.actif) ctx.base.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(id);
      }
      if (entree.motDePasse !== undefined) await ctx.auth.changerMotDePasse(id, entree.motDePasse);

      journaliser(ctx.base, {
        utilisateur: identite.utilisateur.nom,
        origine: 'interface',
        action: 'modification_compte',
        cible: id,
        // Le mot de passe lui-même n'est jamais consigné, seulement le fait du changement.
        detail: Object.keys(entree).join(', '),
      });

      const utilisateur = ctx.auth.lireUtilisateur(id);
      if (!utilisateur) {
        return reponse.code(404).send({ erreur: 'Compte introuvable.', code: 'introuvable' });
      }
      return utilisateur;
    } catch (erreur) {
      return repondreErreur(erreur, reponse, ctx.config.production);
    }
  });

  app.delete('/api/utilisateurs/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    const { id } = requete.params as { id: string };
    if (id === identite.utilisateur.id) {
      return reponse
        .code(422)
        .send({ erreur: 'Un administrateur ne peut pas supprimer son propre compte.', code: 'donnees_invalides' });
    }
    const cible = ctx.auth.lireUtilisateur(id);
    if (!cible) {
      return reponse.code(404).send({ erreur: 'Compte introuvable.', code: 'introuvable' });
    }
    if (cible.role === 'admin' && cible.actif && ctx.auth.compterAdministrateurs() <= 1) {
      return reponse.code(422).send({
        erreur: 'Ce compte est le dernier administrateur actif : nommer un autre administrateur avant de le supprimer.',
        code: 'donnees_invalides',
      });
    }
    ctx.base.prepare('DELETE FROM utilisateurs WHERE id = ?').run(id);
    journaliser(ctx.base, {
      utilisateur: identite.utilisateur.nom,
      origine: 'interface',
      action: 'suppression_compte',
      cible: id,
      detail: cible.email,
    });
    return { supprime: true };
  });
}

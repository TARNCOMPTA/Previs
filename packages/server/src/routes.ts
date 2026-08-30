import {
  ErreurDepot,
  zRequeteConnexion,
  zRequeteCreation,
  zRequeteEnregistrement,
  zRequeteJeton,
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
import type { DepotSqlite } from './depot.js';
import type { Configuration } from './config.js';
import { empreinteJeton, LimiteurConnexions, nouveauJeton, nouvelIdentifiant } from './securite.js';

interface Contexte {
  base: BaseDonnees;
  auth: ServiceAuthentification;
  depot: DepotSqlite;
  config: Configuration;
}

/** Convertit une erreur métier du dépôt en réponse HTTP conforme au contrat. */
function repondreErreur(erreur: unknown, reponse: import('fastify').FastifyReply): void {
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
  reponse.log.error(erreur);
  reponse.code(500).send({
    erreur: erreur instanceof Error ? erreur.message : 'Erreur interne.',
    code: 'erreur_interne',
  });
}

export function enregistrerRoutes(app: FastifyInstance, ctx: Contexte): void {
  const limiteur = new LimiteurConnexions();

  // ─── État du service ────────────────────────────────────────────────────────
  app.get('/api/sante', async () => ({
    service: 'previs',
    etat: 'operationnel',
    dossiers: (ctx.base.prepare('SELECT COUNT(*) AS n FROM dossiers').get() as { n: number }).n,
    comptes: ctx.auth.compterUtilisateurs(),
  }));

  // ─── Authentification ───────────────────────────────────────────────────────
  app.post('/api/auth/connexion', async (requete, reponse) => {
    const cle = requete.ip;
    if (limiteur.bloque(cle)) {
      return reponse.code(429).send({
        erreur: 'Trop de tentatives de connexion. Réessayer dans quelques minutes.',
        code: 'interdit',
      });
    }
    try {
      const { email, motDePasse } = zRequeteConnexion.parse(requete.body);
      const resultat = await ctx.auth.connecter(email, motDePasse);
      if (!resultat) {
        limiteur.echec(cle);
        return reponse
          .code(401)
          .send({ erreur: 'Adresse ou mot de passe incorrect.', code: 'non_authentifie' });
      }
      limiteur.succes(cle);
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
      return repondreErreur(erreur, reponse);
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
      const verifie = await ctx.auth.connecter(identite.utilisateur.email, ancien);
      if (!verifie) {
        return reponse
          .code(401)
          .send({ erreur: 'Le mot de passe actuel est incorrect.', code: 'non_authentifie' });
      }
      await ctx.auth.changerMotDePasse(identite.utilisateur.id, nouveau);
      reponse.clearCookie(NOM_COOKIE, { path: '/' });
      return { modifie: true };
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
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
      return repondreErreur(erreur, reponse);
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
      return repondreErreur(erreur, reponse);
    }
  });

  app.patch('/api/dossiers/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.appliquer(id, zRequetePatch.parse(requete.body), auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
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
      return repondreErreur(erreur, reponse);
    }
  });

  app.post('/api/dossiers/:id/dupliquer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.dupliquer(id, auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
    }
  });

  app.get('/api/dossiers/:id/versions', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.versions(id);
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
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
      return repondreErreur(erreur, reponse);
    }
  });

  app.post('/api/dossiers/:id/versions/:version/restaurer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { ecriture: true })) return;
    try {
      const { id, version } = requete.params as { id: string; version: string };
      return await ctx.depot.restaurer(id, Number(version), auteurDe(identite));
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
    }
  });

  app.post('/api/dossiers/:id/calculer', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id } = requete.params as { id: string };
      return await ctx.depot.calculer(id);
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
    }
  });

  app.post('/api/dossiers/:id/pdf', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse)) return;
    try {
      const { id } = requete.params as { id: string };
      const enregistre = await ctx.depot.lire(id);
      if (!enregistre) {
        return reponse.code(404).send({ erreur: 'Dossier introuvable.', code: 'introuvable' });
      }
      const pdf = await ctx.depot.pdf(id);
      const nomFichier = `${(enregistre.client || enregistre.nom).replace(/[^\w\-]+/g, '-')}-${enregistre.anneeDebut}-Previsionnel.pdf`;
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
      return repondreErreur(erreur, reponse);
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
      return repondreErreur(erreur, reponse);
    }
  });

  app.delete('/api/jetons/:id', async (requete, reponse) => {
    const identite = identifier(ctx.auth, requete);
    if (!exiger(identite, reponse, { admin: true })) return;
    const { id } = requete.params as { id: string };
    ctx.base.prepare('DELETE FROM jetons WHERE id = ?').run(id);
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
      return repondreErreur(erreur, reponse);
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

      const utilisateur = ctx.auth.lireUtilisateur(id);
      if (!utilisateur) {
        return reponse.code(404).send({ erreur: 'Compte introuvable.', code: 'introuvable' });
      }
      return utilisateur;
    } catch (erreur) {
      return repondreErreur(erreur, reponse);
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
    ctx.base.prepare('DELETE FROM utilisateurs WHERE id = ?').run(id);
    return { supprime: true };
  });
}

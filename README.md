# Previs

Logiciel de prévisionnel financier du cabinet **TARN COMPTA**.

Sa particularité : les données se saisissent indifféremment **au clavier dans
l'interface** ou **par un assistant** branché sur un serveur MCP. Les deux
écrivent dans le même dossier, en même temps, sans jamais s'écraser.

---

## Ce que fait le logiciel

**Cinq sections de saisie** — investissement, financement, charges, recettes,
autres — d'où découlent, recalculés à chaque frappe :

compte de résultat · soldes intermédiaires de gestion · capacité
d'autofinancement · douze ratios · seuil de rentabilité et point mort · besoin
en fonds de roulement · plan de financement · trésorerie mensuelle sur tout
l'horizon · déclarations de TVA · bilans · contrôles de cohérence.

**Trois régimes fiscaux** : société à l'impôt sur les sociétés, profession
libérale au réel (BNC), entreprise individuelle au réel (BIC à l'IR). Le régime
choisi change les libellés, les champs affichés et les règles de calcul —
un dossier BNC ne parle ni d'impôt sur les sociétés ni de dividendes.

**Un dossier PDF** d'une vingtaine de pages à la charte du cabinet, produit
depuis les mêmes données, avec page de garde, dix-neuf sections numérotées,
graphiques et annexes mensuelles.

### Deux partis pris

**L'équilibre du bilan est obtenu par construction, pas par ajustement.** Chaque
compte de tiers vaut « cumul engagé − cumul réglé » des mêmes séries qui
alimentent la trésorerie : aucun montant ne peut figurer d'un seul côté du bilan.

**Un écart n'est jamais bouché.** S'il subsiste, il s'affiche, avec son montant,
l'exercice concerné et un lien vers la section à corriger. Aucun compte
d'attente, jamais.

---

## Architecture

```
packages/core     Modèle de données (zod) et moteur de calcul — isomorphe.
                  Utilisé tel quel par l'interface, le serveur et le PDF :
                  les trois obtiennent donc exactement les mêmes chiffres.

packages/server   API HTTP Fastify sur SQLite : authentification, dossiers,
                  historique des versions, génération PDF, point d'entrée MCP.
                  Sert aussi l'interface construite.

packages/mcp      Serveur MCP : quinze outils en français pour lire, remplir,
                  calculer et contrôler un dossier. Montable en HTTP dans le
                  serveur, ou exécutable en processus autonome.

packages/web      Interface React. Appelle le moteur de calcul localement :
                  la saisie se répercute instantanément sur tous les états.
```

Le flux d'une modification, d'où qu'elle vienne :

```
saisie clavier ─┐                        ┌─ recalcul local instantané
                ├─→ dossier normalisé ───┤
assistant MCP ──┘                        └─→ enregistrement, nouvelle version
                                              ↓
                                    contrôles de cohérence
```

### Cohabitation de l'assistant et du clavier

L'assistant n'envoie jamais un dossier entier : il envoie des **opérations
ciblées** (`ajouter_ligne`, `modifier_ligne`, `definir`). Une modification de
ligne ne touche donc pas les autres, y compris celles saisies au clavier à la
même seconde.

Chaque écriture porte la **version attendue** du dossier. Si elle a changé
entre-temps, le serveur répond 409 en joignant le dossier à jour, que l'appelant
rejoue. L'interface, elle, vérifie périodiquement la version en base : quand
l'assistant a écrit, elle recharge, l'annonce par un bandeau et **surligne les
lignes proposées** d'un liseré violet, à relire avant validation.

---

## Développement

```bash
npm install
npm run dev            # serveur sur :8080, interface sur :5173
```

Autres commandes :

```bash
npm test               # 46 tests du moteur de calcul
npm run typecheck      # TypeScript strict sur les quatre paquets
npm run build          # construit les quatre paquets
```

Créez un `.env` à partir de `.env.example` et renseignez `SESSION_SECRET`,
`BOOTSTRAP_ADMIN_EMAIL` et `BOOTSTRAP_ADMIN_PASSWORD` pour obtenir un premier
compte au démarrage.

La génération PDF a besoin de Chromium : renseignez `CHROMIUM_PATH` si le
binaire n'est pas dans `/usr/bin/chromium`.

---

## Brancher l'assistant

Deux voies, selon ce que le client sait faire.

### Par connecteur OAuth — le cas d'un connecteur personnalisé de Claude

Rien à préparer, aucune clé à créer : le connecteur ne demande qu'une adresse.

| Réglage | Valeur |
|---|---|
| Adresse du serveur | `https://previs.tarncompta.fr/mcp` |
| ID client OAuth | *laisser vide* |
| Secret client OAuth | *laisser vide* |

Le connecteur s'enregistre lui-même (RFC 7591), ouvre un écran de consentement aux
couleurs du cabinet, et c'est là qu'on saisit **son adresse et son mot de passe Previs** :
l'autorisation vaut pour ce compte, avec ses droits. Elle apparaît ensuite dans
**Administration → Connecteurs autorisés**, où la révoquer coupe l'accès sur-le-champ.

Le serveur d'autorisation suit la spécification MCP : code d'autorisation avec PKCE
obligatoire en S256, clients publics sans secret, jeton d'accès d'une heure et jeton de
rafraîchissement de trente jours qui tourne à chaque échange. Un jeton de
rafraîchissement rejoué révoque toute la lignée — c'est la seule façon de constater une
fuite. Rien n'est conservé en clair : ni code, ni jeton, seulement leur empreinte
SHA-256.

Les points d'entrée, si un client a besoin de les connaître :
`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
`/oauth/enregistrer`, `/oauth/autoriser`, `/oauth/jeton`, `/oauth/revoquer`.

> `PUBLIC_URL` doit être l'adresse publique **en https** : c'est elle que publient les
> métadonnées, et un connecteur refuse un serveur d'autorisation en clair. Le service
> l'annonce au démarrage si ce n'est pas le cas.

### Par jeton d'API — Claude Code, un appel en ligne de commande

Créez un jeton dans **Administration → Jetons d'API**. Il n'est affiché qu'une
seule fois : seule son empreinte SHA-256 est conservée.

| Réglage | Valeur |
|---|---|
| Adresse du serveur | `https://previs.tarncompta.fr/mcp` |
| Authentification | `Authorization: Bearer previs_…` |

L'en-tête propre au logiciel, `x-previs-token`, est accepté de façon équivalente : les
clients qui permettent d'ajouter un en-tête arbitraire peuvent l'employer. Aucune autre
forme n'est reconnue — pas de jeton dans l'URL, qui figurerait dans les journaux.

Un jeton d'API n'administre pas : il vit en clair dans un fichier de configuration, et
n'ouvre donc ni la gestion des comptes, ni celle des jetons, quel que soit le rôle de
son titulaire. Il en va de même d'un jeton OAuth, qui ne vaut que pour `/mcp`.

### Par processus local — quand le client ne sait pas parler HTTP

Le serveur MCP autonome ne détient aucune donnée : il dialogue avec l'API par HTTP.
Il n'est pas publié sur npm, il faut donc une copie du dépôt sur la machine.

```json
{
  "mcpServers": {
    "previs": {
      "command": "node",
      "args": ["/chemin/vers/previs/packages/mcp/dist/stdio.js"],
      "env": {
        "PREVIS_URL": "https://previs.tarncompta.fr",
        "PREVIS_TOKEN": "previs_…"
      }
    }
  }
}
```

Les quinze outils : `lister_dossiers`, `lire_dossier`, `creer_dossier`,
`definir_identite`, `definir_parametres`, `ajouter_lignes`, `modifier_ligne`,
`supprimer_ligne`, `appliquer_operations`, `calculer_dossier`, `etat_financier`,
`controler_coherence`, `lister_versions`, `restaurer_version`, `generer_pdf`.

Après chaque écriture, l'outil renvoie le journal des modifications **et** l'état
des contrôles : l'assistant voit immédiatement s'il vient de déséquilibrer le
bilan. `generer_pdf` refuse de produire le document tant qu'un contrôle est en
erreur, sauf mention explicite du contraire.

---

## Identité du cabinet et logos

L'écran **Administration → Identité du cabinet** porte tout ce qui s'imprime sur les
dossiers remis : raison sociale, qualité, expert-comptable signataire, forme juridique,
capital, SIRET, TVA intracommunautaire, inscription au tableau de l'Ordre, adresse,
téléphone, courriel, site, logo, et l'avertissement de fin de dossier. Rien n'est figé
dans le code : le logiciel peut servir un autre cabinet sans être recompilé.

Chaque dossier porte en plus le **logo de son client**, déposé depuis
« Autres → Identité et introduction ». Il figure sur la page de garde, en regard de
celui du cabinet.

Les deux logos suivent les mêmes règles : PNG, JPEG ou WebP — le SVG est refusé, c'est
un document XML et non une image inerte ; le contenu du fichier est vérifié sur ses
octets et non sur le type déclaré ; l'image est réduite dans le navigateur avant l'envoi
et plafonnée à 512 Ko. Elle voyage en URI de données, jamais par une URL : le PDF est
produit dans un Chromium coupé du réseau et la politique de contenu de l'interface
n'autorise aucune image distante.

Le logo d'un client n'entre pas dans le contenu versionné du dossier : restaurer une
version antérieure ne le fait pas disparaître, et l'historique ne recopie pas la même
image à chaque écriture. Une duplication de dossier, elle, le reprend.

## Sécurité

Le logiciel héberge les dossiers de clients réels du cabinet. Les protections sont
posées par le service lui-même, jamais déléguées au seul reverse-proxy :

| Menace | Réponse |
|---|---|
| Vol de la base ou d'une sauvegarde | Mots de passe hachés par scrypt, jetons d'API et identifiants de session stockés en SHA-256 ; base et journaux WAL créés en 0600 |
| Essai de mots de passe en série | Deux compteurs indépendants — dix échecs par adresse et par quart d'heure, vingt par compte et par heure |
| Adresse client usurpée | `X-Forwarded-For` n'est cru que des réseaux listés dans `TRUST_PROXY`, jamais de tout le monde |
| Requête intersite (CSRF) | Cookie `SameSite=lax`, et contrôle de l'en-tête `Origin` sur toute écriture authentifiée par session |
| Jeton d'API dérobé sur un poste | Un jeton n'ouvre ni la gestion des comptes ni l'émission d'autres jetons, quel que soit le rôle de son titulaire |
| Injection dans le document PDF | Échappement systématique du contenu du dossier, et JavaScript coupé dans le Chromium qui imprime |
| Pollution de prototype par l'assistant | Chemin d'opération borné aux sections du dossier, segments `__proto__`, `prototype` et `constructor` refusés, lignes nettoyées avant fusion |
| Dossier démesuré envoyé à l'API | Toutes les listes du modèle sont plafonnées (500 lignes, 20 exercices) |
| Perte de l'accès administrateur | Le dernier administrateur actif ne peut être ni supprimé, ni rétrogradé, ni désactivé |
| Divulgation par un message d'erreur | En production, le détail d'une erreur interne reste dans le journal ; la réponse ne le porte pas |
| Saturation par l'export PDF | Trente rendus par compte et par quart d'heure |
| Code d'autorisation intercepté | PKCE obligatoire en S256 ; « plain » n'est ni accepté ni annoncé, et un code rejoué révoque tout ce qui avait été émis |
| Détournement du retour d'un connecteur | L'adresse de redirection est comparée caractère par caractère à celle enregistrée, et vérifiée **avant** toute redirection : une adresse inconnue ne provoque aucun renvoi |
| Jeton de rafraîchissement dérobé | Rotation à chaque échange ; le rejeu de l'ancien révoque la lignée entière du compte pour ce client |
| Paramètres d'autorisation modifiés à la soumission | Le formulaire de consentement ne porte qu'un identifiant opaque : les paramètres restent au serveur |
| Écritures anonymes en boucle | Enregistrement de client et ouverture de demande plafonnés à trente par adresse et par quart d'heure |

Chaque point est verrouillé par un essai : `packages/core/test/securite.test.ts` pour le
modèle et les opérations, `packages/server/test/securite.test.ts` pour l'API,
`packages/server/test/oauth.test.ts` pour le serveur d'autorisation.

Le journal d'audit consigne connexions, échecs de connexion, changements de mot de
passe, créations et suppressions de comptes et de jetons, enregistrements de clients
OAuth, consentements accordés ou refusés, révocations d'autorisation, et exports PDF. Il
ne consigne jamais un mot de passe, un jeton en clair ni le contenu d'un dossier.

## Déploiement

Voir **[deploy/README-deploiement.md](deploy/README-deploiement.md)** : procédure
pas à pas sur un VPS Debian ou Ubuntu neuf, du premier SSH au certificat
Let's Encrypt, avec la sauvegarde de la base et la mise à jour.

En résumé : `docker compose up -d --build`, puis nginx en reverse-proxy HTTPS.
Tout l'état tient dans `data/previs.db`.

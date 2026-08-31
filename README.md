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

**Un dossier PDF** d'une vingtaine de pages à la charte pourpre et or du
cabinet, produit depuis les mêmes données : couverture à fond perdu, sommaire,
page de synthèse, dix-sept sections numérotées, graphiques et annexes
mensuelles. Les polices — Spectral en titrage, Hanken Grotesk en texte, IBM Plex
Mono pour les chiffres — sont incorporées au document : Chromium imprime sans
accès réseau, et un serveur sans fonte n'aurait rien à mettre à la place.

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
                  Vue scindée : la saisie à gauche, un état financier à droite,
                  qui se recalcule à chaque frappe.
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
npm test               # 77 essais du moteur, 241 du serveur, 11 du magasin de l'interface
npm run typecheck      # TypeScript strict sur les quatre paquets
npm run build          # construit les quatre paquets
```

Créez un `.env` à partir de `.env.example` et renseignez `SESSION_SECRET`,
`BOOTSTRAP_ADMIN_EMAIL` et `BOOTSTRAP_ADMIN_PASSWORD` pour obtenir un premier
compte au démarrage.

La génération PDF a besoin de Chromium. Sans `CHROMIUM_PATH`, c'est Playwright
qui choisit son binaire — la coquille sans affichage, bâtie pour cela ; ne
renseignez la variable que pour imposer un Chromium de distribution.

---

## Deux écrans côte à côte

La saisie d'un dossier se fait devant son résultat. Un écran de saisie s'ouvre à gauche, un
état financier à droite, et le moteur tourne à chaque frappe : un loyer corrigé se lit
aussitôt dans le compte de résultat, un emprunt ajouté dans le plan de financement.

- Le tableau de droite se choisit dans son sélecteur, et il est **proposé selon l'écran de
  saisie** — le plan de financement en face des investissements et des financements, le
  compte de résultat en face des charges et des recettes, le bilan en face de « Autres ».
- Le choix voyage dans l'adresse (`?resultat=bilan`) : un lien partagé rouvre la même paire.
- La **poignée** entre les deux volets se glisse à la souris, se déplace aux flèches du
  clavier, revient à sa largeur par défaut au double-clic, et sa position est retenue. Le
  volet de saisie ne descend jamais sous 520 px, celui de résultat sous 380.
- Le bouton `▮▮` de l'en-tête revient à un seul écran, avec la navigation latérale. Un état
  ouvert depuis cette navigation s'affiche en pleine largeur ; le bouton `⤢` du volet y mène
  directement.
- Sous 1 180 px de large, deux volets ne tiennent pas — le tableau le plus étroit demande
  400 px et la grille de saisie la plus modeste 520 : la vue se replie alors d'elle-même sur
  un seul écran et le bouton le dit.

Dans une grille de saisie, la **colonne d'intitulés reste figée** quand les colonnes
d'exercices défilent latéralement : à trois exercices déjà, la grille du personnel demande
2 299 px. On ne saisit pas un montant sans voir à quel poste il s'applique.

---

## Se connecter

Deux moyens, et le premier reste toujours possible.

### Mot de passe

Haché par scrypt. Dix caractères au moins. Deux compteurs indépendants arrêtent un
essai en série : dix échecs par adresse et par quart d'heure, vingt par compte et par
heure. Chacun change le sien depuis **Mon compte** — y compris un compte en lecture
seule, car sécuriser son compte n'est pas une écriture métier.

Le changement ferme toutes les sessions du compte, et propose — case cochée par défaut —
de révoquer aussi ses connecteurs OAuth : ils ont été autorisés avec le mot de passe
qu'on vient de changer, et leur accès vaut trente jours. Les clés d'accès, elles, sont
laissées en place : les effacer priverait le compte de son moyen le plus sûr au moment
même où il réagit à une alerte.

### Clé d'accès

Une clé d'accès — passkey — remplace le mot de passe par le déverrouillage de l'appareil :
Face ID, empreinte, code. La clé privée ne quitte jamais l'appareil et **ne signe que
pour le domaine où elle a été créée** : un faux courriel menant à un site qui ressemble à
Previs n'obtient rien. C'est la seule raison de l'ajouter.

On l'enregistre depuis **Mon compte → Clés d'accès**, sur son appareil personnel. Le mot
de passe actuel est redemandé à ce moment-là : sans cela, une session dérobée suffirait à
poser un accès durable qu'un changement de mot de passe ne refermerait pas. Ensuite,
l'écran de connexion offre « Se connecter avec une clé d'accès » — **sans saisir ni
adresse ni mot de passe** : la clé est découvrable, c'est l'authentificateur qui dit quel
compte il ouvre.

Dix clés par compte. Un administrateur voit et retire les clés d'un autre compte —
répondre à « quelqu'un a-t-il greffé une clé sur ce compte ? », et fermer la porte quand
le titulaire est absent — mais aucune route ne lui permet d'en poser une pour autrui.

Ce qui tient la sûreté du procédé :

| Exigence | Comment |
|---|---|
| Le défi ne vient jamais du client | Il reste en base, le client ne reçoit qu'un identifiant opaque, et il est consommé par un unique `DELETE … RETURNING` — lire puis vérifier puis supprimer laisserait deux requêtes concurrentes franchir le même |
| Un défi ne vaut que pour sa cérémonie | La colonne `genre` distingue enregistrement et connexion ; un défi de l'un est refusé à l'autre |
| L'origine et le domaine viennent de `PUBLIC_URL` | Jamais de l'en-tête `Host`, que n'importe quel client forge — sinon l'attaquant choisit pour quel domaine la signature vaut |
| Le porteur est exigé et rapproché | L'authentificateur annonce le compte qu'il ouvre ; une discordance avec la clé trouvée en base est un refus |
| La vérification du porteur est exigée | Sans code ni biométrie, un appareil ramassé ouvrirait le compte |
| Le compteur est laissé à la bibliothèque | Elle refuse une régression — signe d'un authentificateur cloné — et saute le contrôle quand il vaut zéro de part et d'autre : une clé synchronisée rapporte zéro à vie, un contrôle maison plus strict les casserait toutes |
| Un échec ne dit rien | Clé inconnue, signature invalide, compte désactivé : le même message |
| Aucun message de la bibliothèque n'est restitué | Selon le contrôle qui échoue, il recopie le défi |

Les clés d'accès exigent un contexte sûr : **https**, ou la boucle locale. Sur une
installation en clair, elles se désactivent d'elles-mêmes et l'écran le dit, avec ce
qu'il faut corriger. Le mot de passe, lui, fonctionne partout.

> L'écran de consentement OAuth ne connaît que le mot de passe. Y faire fonctionner une
> clé d'accès demanderait un script, donc de relâcher sa politique de contenu
> `default-src 'none'` sur la page même dont `form-action` intègre une origine venue du
> client. C'est un compromis que nous refusons.

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
| Faux site imitant Previs | Une clé d'accès ne signe que pour le domaine où elle a été créée ; l'origine attendue vient de `PUBLIC_URL`, jamais de l'en-tête `Host` |
| Assertion WebAuthn rejouée | Le défi reste au serveur et disparaît à son premier usage, par une écriture unique et conditionnelle |
| Authentificateur cloné | Le compteur de signature est conservé et confié à la bibliothèque, qui refuse une régression sans casser les clés synchronisées |
| Clé posée depuis une session dérobée | Le mot de passe actuel est exigé pour enregistrer une clé, sur le compteur d'essais du changement de mot de passe |
| Jeton d'API transformé en session d'interface | `exiger({ navigateur: true })` refuse l'origine « mcp » sur le mot de passe et sur les clés |
| Connecteur qui survit au changement de mot de passe | La révocation des autorisations OAuth du compte est proposée avec le changement, cochée par défaut |

Chaque point est verrouillé par un essai : `packages/core/test/securite.test.ts` pour le
modèle et les opérations, `packages/server/test/securite.test.ts` pour l'API,
`packages/server/test/oauth.test.ts` pour le serveur d'autorisation, et
`packages/server/test/cles.test.ts` pour les clés d'accès — où un authentificateur
factice signe pour de vrai et sait aussi mal se comporter : signer pour une autre
origine, omettre la vérification du porteur, faire régresser son compteur.

Le journal d'audit consigne connexions, échecs de connexion, changements de mot de
passe, créations et suppressions de comptes et de jetons, enregistrements et retraits de
clés d'accès, connexions par clé, enregistrements de clients OAuth, consentements accordés
ou refusés, révocations d'autorisation, et exports PDF. Il
ne consigne jamais un mot de passe, un jeton en clair ni le contenu d'un dossier.

## Déploiement

Voir **[deploy/README-deploiement.md](deploy/README-deploiement.md)** : procédure
pas à pas sur un VPS Debian ou Ubuntu neuf, du premier SSH au certificat
Let's Encrypt, avec la sauvegarde de la base et la mise à jour.

En résumé : `docker compose up -d --build`, puis nginx en reverse-proxy HTTPS.
Tout l'état tient dans `data/previs.db`.

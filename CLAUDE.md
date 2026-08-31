# Previs — consignes pour Claude Code

Logiciel de prévisionnel financier du cabinet TARN COMPTA (Aymeric HANGARD,
70 Chemin de Mézard, 81000 ALBI). Les dossiers contiennent des données de
clients réels : traite-les comme telles.

## Règles absolues du projet

1. **Ne jamais inventer un chiffre dans un dossier client.** Si une donnée
   manque, la demander. Une ligne créée à zéro est la bonne façon de proposer
   une trame sans présumer d'un montant : elle n'apparaît pas dans le PDF remis.
2. **Ne jamais boucher un écart de bilan.** Aucun compte d'attente, aucun
   ajustement de bouclage. Si un contrôle signale un écart, la cause se trouve
   dans le besoin en fonds de roulement ou dans les flux — c'est là qu'on corrige.
3. **Ne jamais désactiver un test pour faire passer une construction.** Si un
   test d'équilibre échoue, c'est le moteur qui est faux, pas le test.

## Architecture

| Paquet | Rôle |
|---|---|
| `packages/core` | Modèle zod et moteur de calcul, isomorphe navigateur / Node |
| `packages/server` | API Fastify sur SQLite, PDF, point d'entrée MCP en HTTP |
| `packages/mcp` | Serveur MCP, quinze outils, transports HTTP et stdio |
| `packages/web` | Interface React, appelle le moteur localement |

Le moteur est **pur et déterministe** : ni date du jour, ni fuseau horaire, ni
état global. C'est ce qui garantit que l'interface, le serveur et le PDF
affichent les mêmes chiffres.

### Où vit quoi

```
core/src/model/          les cinq sections, l'identité, les paramètres,
                         et l'identité du cabinet (cabinet.ts)
core/src/engine/         immobilisations, emprunts, flux, fiscal, états,
                         contrôles, et index.ts qui orchestre le tout
core/src/api/            contrat HTTP partagé et opérations atomiques
server/src/depot.ts      persistance, versions, verrouillage optimiste
server/src/cabinet.ts    identité du cabinet et contrôle des logos déposés
server/src/oauth.ts      serveur d'autorisation OAuth 2.1 du point d'entrée MCP
server/src/oauthRoutes.ts découverte, consentement, jetons, révocation
server/src/cles.ts       clés d'accès WebAuthn : cérémonies, défis, vérification
server/src/pdf/          document HTML imprimé par Chromium, charte pourpre
server/src/pdf/file.ts   plafond d'impressions simultanées, délai d'impression
server/src/pdf/polices/  les six woff2 incorporées, et leur générateur
mcp/src/outils.ts        les quinze outils exposés à l'assistant
web/src/store/dossier.ts état, recalcul, enregistrement différé, synchronisation
web/src/layout/          coquille d'un dossier, registre des écrans, volet de résultat
web/src/ui/              composants partagés — n'en créer un nouveau qu'ici
```

### Le point délicat : l'équilibre du bilan

Chaque compte de tiers vaut `encoursCloture(poste, exercice)`, soit
« cumul engagé − cumul réglé » des séries qui alimentent aussi la trésorerie.
Toute nouvelle charge, tout nouveau produit doit donc :

- alimenter un `Poste` (engagé et réglé), **ou** avoir une contrepartie
  explicite au bilan ;
- figurer dans le besoin en fonds de roulement s'il crée une créance ou une dette.

Un poste ajouté au compte de résultat sans contrepartie déséquilibre le bilan de
son montant exact. Les tests le détectent immédiatement.

### Le second point délicat : le chemin de la saisie

`calculer()` tourne à **chaque frappe** dans l'interface. Trois invariants tiennent
cette performance ; les défaire coûterait immédiatement un facteur deux :

1. **Le moteur ne valide pas.** `calculer()` appelle `ajusterSeries()`, pas
   `normaliserDossier()`. La validation zod représentait la moitié du coût d'un
   recalcul. Elle est faite aux frontières, et à elles seules : lecture en base
   (`depot.ts`), requêtes HTTP (schémas du contrat), chargement dans l'interface,
   écritures du serveur MCP (`appliquerOperations`).
2. **`ajusterSeries()` préserve les identités.** Un objet dont rien ne change est
   renvoyé tel quel. Le magasin de l'interface s'appuie dessus pour ne recopier que
   le chemin modifié — partage structurel — au lieu du dossier entier.
3. **Une ligne créée doit être complète.** Puisque le moteur ne remplit plus les
   valeurs par défaut, toute ligne nouvelle passe par `completerLigne()`, qui
   applique le schéma zod de sa liste.

`packages/core/test/performance.test.ts` verrouille ces trois points. Le chronométrage y
prend le **minimum** de plusieurs lots, après chauffe : la contention ne peut que ralentir
un lot, et le plus rapide est donc la mesure la moins polluée — et la plus sévère à seuil
égal. Le plafond de cinq millisecondes par calcul est une exigence de produit, généreuse à
dessein ; les deux garde-fous de régression sont des **rapports**, indépendants de la
machine :

- `calculer()` doit coûter moins de 1,5 fois `normaliserDossier()` sur le même dossier —
  remettre la validation dedans porte ce rapport à 2,3, mesuré ;
- doubler les lignes doit coûter moins de 2,5 fois — un parcours quadratique glissé dans la
  boucle mensuelle des charges rend 3,05, mesuré.

Dans les deux cas, le plafond de cinq millisecondes passait sans broncher : c'est
précisément le facteur deux qu'il laissait filer. Ne jamais remettre de validation dans
`calculer()` : ajouter plutôt la frontière manquante.

### Le troisième point délicat : ce que le PDF ne peut pas faire

Chromium imprime le dossier **sans aucun accès réseau** : chaque requête de la page est
avortée par `contexte.route('**/*', …)`, dans `pdf/index.ts`. Les drapeaux de lancement n'y
sont pour rien — `--disable-background-networking` ne coupe que les services d'arrière-plan
du navigateur, jamais les requêtes du document. La différence se constate :
`test/reseau-pdf.verification.ts`, lancée à la main, montre un serveur témoin touché deux
fois sans interception et zéro fois avec.

Trois conséquences qui ne se devinent pas :

1. **Les polices sont incorporées en base64** (`pdf/polices.ts`, engendré par
   `polices/engendrer.mjs`). Une police appelée depuis le réseau ne serait jamais chargée.
   Le séparateur de milliers du moteur, l'espace **fine** insécable U+202F, n'existe dans
   aucune des six faces : `pdf/nombres.ts` la remplace par U+00A0, dont l'avance vaut
   exactement celle d'un chiffre. Tout montant du PDF passe par ce module, jamais par
   `formaterMontant()` directement.
2. **Le pied de page est le gabarit natif de Chromium**, seul à savoir compter les pages.
   Il est rendu dans un document isolé — d'où ses styles en ligne et ses deux @font-face —
   et il est dessiné sur **toutes** les pages, marges nulles comprises : la couverture et
   les coordonnées lui réservent donc 16 mm (`--bande-pied`). Il n'y a pas d'en-tête.
3. **Aucun chiffre n'est tronqué.** La largeur des colonnes est calculée sur la plus longue
   chaîne réellement imprimée (`composants.ts`, `repartirColonnes()`), colonne de
   pourcentage comprise, et les tableaux se découpent en blocs nommés plutôt que de serrer.
   Ni `overflow: hidden` ni `text-overflow: ellipsis` sur une cellule : « 92 0… » se lit
   comme un nombre complet, et un chiffre amputé en silence est aussi faux qu'un chiffre
   inventé.

`packages/server/test/pdf.test.ts` verrouille ces points sur trois régimes et un à dix
exercices : parité des cellules, caractères absents des polices, trous de gabarit.

Deux plafonds encadrent enfin l'impression, dans `pdf/file.ts` : **deux Chromium à la fois**
au plus, douze demandes en attente, et **soixante secondes** par impression. Un export
coûte 160 Mo de pointe et 480 ms mesurés ; sans plafond, les trente que la limitation de
débit autorise par quart d'heure pouvaient partir ensemble et réclamer cinq gigaoctets. Le
jeton est **transmis** au premier de la file, jamais rendu puis repris : décrémenter d'abord
laissait le compteur sous le plafond le temps d'une micro-tâche, et trois Chromium
tournaient là où le plafond en promettait deux.

Et le budget d'exports est **unique par titulaire, quel que soit le canal** : le compteur
naît dans `index.ts` et sert à la fois la route `POST /api/dossiers/:id/pdf` et l'outil MCP
« generer_pdf », que `mcpHttp.ts` enveloppe pour cela (`bornerExportPdf`). Deux compteurs
séparés offriraient au porteur d'un jeton deux budgets au lieu d'un.

### Le logo n'est pas une donnée du dossier

Le logo du client vit dans sa propre colonne de la table `dossiers`, jamais dans le
JSON versionné, et celui du cabinet dans la table `cabinet`. Deux raisons : restaurer
une version antérieure ne doit pas faire disparaître un logo, et l'archiver à chaque
écriture recopierait la même image dans tout l'historique. Un logo déposé est vérifié
sur ses octets, pas sur le type déclaré ; le SVG est refusé — c'est un document XML,
pas une image inerte.

Rien de l'identité du cabinet n'est écrit en dur : `CABINET_PAR_DEFAUT` ne sert qu'au
premier démarrage, tout le reste vient de l'écran Administration.

## Conventions

- **Français partout** : libellés, messages, commentaires, noms de variables et
  de fonctions. Majuscules accentuées (É, À), espace insécable avant `: ; ? ! %`.
- **TypeScript strict.** Aucun `any` implicite, aucun `@ts-ignore`.
- Les commentaires expliquent le **pourquoi**, jamais le quoi. Pas de bannière
  décorative, pas de commentaire qui paraphrase la ligne suivante.
- Montants en euros, taux en pourcentage (20 signifie 20 %), index d'exercice à
  partir de 0, mois à partir de 1 dans l'exercice concerné.

## Vérifier son travail

```bash
npm run typecheck      # les quatre paquets
npm test               # 77 essais du moteur et du modèle, 221 essais du serveur
npm run build
```

Pour une modification du moteur, exécuter les tests est **obligatoire** : ils
vérifient l'équilibre du bilan et les contrôles de cohérence sur un dossier
complet, pour chacun des trois régimes.

Les essais de l'API (`packages/server/test/`) passent par `app.inject()` : ni port
ouvert, ni Chromium lancé, base en mémoire. Ceux du PDF non plus ne lancent Chromium :
`construireHtml()` est pure, et c'est elle qui porte tout ce qui peut être faux dans les
chiffres. La mise en page, elle, se regarde — voir ci-dessous.

Un fichier de `test/` dont le nom porte `.verification.ts` au lieu de `.test.ts` n'est pas
dans la suite : il est typé mais lancé à la main, parce qu'il exige Chromium. Il n'y en a
qu'un, `reseau-pdf.verification.ts`, et il éprouve une propriété qui ne s'observe pas
autrement.

Pour une modification de l'interface, la lancer réellement : `npm run dev`, puis
parcourir les écrans touchés. Un typecheck qui passe ne prouve pas qu'un écran
s'affiche.

Deux écueils propres à la **vue scindée** (`web/src/layout/`), qui ne se devinent pas :

1. **Une frontière `Suspense` par volet.** Les écrans sont chargés à la demande ; sans
   frontière propre, le premier affichage de l'un remplace toute la fenêtre par
   « Chargement… ». La coquille en pose une par volet.
2. **`ChampMontant` ne remonte sa saisie qu'au `blur`.** Tout ce qui démonte un volet —
   bascule du bouton, franchissement du seuil de 1 180 px — doit donc valider la frappe en
   cours d'abord, sans quoi le montant revient à sa valeur précédente sous les yeux de
   l'utilisateur.

Et un défaut préexistant, qu'il vaut mieux connaître : `overflow-x: auto` fait de
`.defilement-horizontal` un conteneur de défilement sur **les deux** axes, de hauteur libre.
Un en-tête de tableau en `position: sticky; top: 0` s'y accroche donc et ne colle jamais.
Le calage latéral de la colonne d'intitulés, lui, fonctionne : cet axe défile vraiment.

Pour une modification du chemin de saisie, mesurer : ouvrir un dossier d'une
soixantaine de lignes et chronométrer la tâche synchrone déclenchée par une frappe.
Elle doit rester sous six millisecondes.

Pour une modification du PDF, produire le document et le **regarder**, pour les trois
régimes et pour un, trois et dix exercices : un typecheck qui passe n'exclut ni une page
blanche aux marges parfaites, ni un chiffre qui déborde. Attention aux visionneuses de
fortune : plusieurs bibliothèques ne peignent pas les sous-ensembles IBM Plex Mono
incorporés et rendent des colonnes de montants **vides**, ce qui n'est pas un défaut du
document. Extraire la couche de texte, ou capturer l'HTML dans Chromium, lève le doute.

## Sécurité

Mots de passe hachés par scrypt ; jetons d'API et identifiants de session stockés
en SHA-256 ; base SQLite et journaux WAL en 0600 ; limitation des tentatives de
connexion par adresse **et** par compte. Ne jamais consigner un mot de passe, un
jeton en clair ou le contenu d'un dossier dans les journaux. Le serveur refuse de
démarrer en production sans `SESSION_SECRET`.

Sept règles à ne pas défaire :

1. **Un chemin d'opération est borné.** `resoudreChemin()` n'accepte que les sept
   sections du dossier, refuse `__proto__`, `prototype` et `constructor`, et ne
   traverse que des propriétés propres. Toute ligne venue de l'assistant passe par
   `nettoyerLigne()` avant d'être fusionnée.
2. **Un jeton d'API n'administre pas.** Il vit en clair dans un fichier de
   configuration : `exiger({ admin: true })` le refuse quel que soit le rôle.
3. **`trustProxy` n'est jamais `true`.** Sinon n'importe quel client forge son
   adresse et contourne la limitation des tentatives.
4. **Une écriture par cookie exige un `Origin` connu.** C'est la seconde barrière
   derrière `SameSite=lax` ; les appels par jeton en sont dispensés, un en-tête
   personnalisé ne se forgeant pas depuis une page tierce.
5. **PKCE est obligatoire, en S256 seulement, et les jetons de rafraîchissement
   tournent.** « plain » n'est ni accepté ni annoncé. Un code ou un jeton de
   rafraîchissement rejoué révoque toute la lignée du compte pour ce client : c'est le
   seul moyen de constater une fuite. Rien n'est conservé en clair, ni code ni jeton.
   L'adresse de redirection d'un client est vérifiée **avant** toute redirection, sans
   quoi le serveur d'autorisation devient une redirection ouverte.
   **Un code non encore échangé vaut un accès**, et compte donc partout où l'on compte les
   accès : l'écran Administration le montre dès l'instant du consentement — sans quoi rien
   n'y apparaît pendant les dix minutes où le code vit — et la révocation le consomme, sans
   quoi l'accès se rouvrait juste après avoir été coupé.

6. **Une cérémonie WebAuthn ne prouve rien sans ses cinq contrôles.** Le défi vient du
   serveur et n'y revient jamais — il est consommé par un unique `DELETE … RETURNING`,
   car lire puis vérifier puis supprimer laisse deux requêtes concurrentes franchir le
   même. L'origine et l'identifiant de partie de confiance viennent de `PUBLIC_URL`,
   jamais de l'en-tête `Host`. Le genre du défi distingue enregistrement et connexion. Le
   porteur annoncé est exigé et rapproché de la clé trouvée en base. La vérification du
   porteur est exigée. Le compteur est laissé à la bibliothèque : exiger une progression
   stricte casserait toutes les clés synchronisées, qui rapportent zéro à vie.
7. **Poser une clé d'accès exige le mot de passe actuel, et une session de l'interface.**
   `exiger({ navigateur: true })` refuse un jeton d'API — qui vit en clair dans un fichier
   de configuration — sur le mot de passe comme sur les clés. Sans la preuve fraîche, une
   session dérobée deviendrait un accès durable qu'un changement de mot de passe ne
   refermerait pas.

`packages/core/test/securite.test.ts`, `packages/server/test/securite.test.ts`,
`packages/server/test/oauth.test.ts` et `packages/server/test/cles.test.ts` verrouillent
ces points. Un échec y signale une protection retirée, pas un chiffre qui a bougé.

Dans `cles.test.ts`, un authentificateur factice signe pour de vrai et sait aussi mal se
comporter : signer pour une autre origine, pour un autre domaine, omettre la vérification
du porteur, annoncer le porteur d'un autre compte, faire régresser son compteur. Un
contrôle qu'on ne peut pas mettre en défaut n'est pas éprouvé.

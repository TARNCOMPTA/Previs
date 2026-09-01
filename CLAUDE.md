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
server/src/depot.ts      persistance, versions, verrouillage optimiste, transactions
server/src/cabinet.ts    identité du cabinet et contrôle des logos déposés
server/src/oauth.ts      serveur d'autorisation OAuth 2.1 du point d'entrée MCP
server/src/oauthRoutes.ts découverte, consentement, jetons, révocation
server/src/cles.ts       clés d'accès WebAuthn : cérémonies, défis, vérification
server/src/pdf/          document HTML imprimé par Chromium, charte pourpre
server/src/pdf/file.ts   plafond d'impressions simultanées, délai d'impression
server/src/pdf/polices/  les huit woff2 incorporées, et leur générateur
mcp/src/outils.ts        les quinze outils exposés à l'assistant
web/src/store/dossier.ts état, recalcul, enregistrement différé, synchronisation
web/test/                essais du magasin : ce qui part, ce qui est gardé, ce qui est remplacé
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

Et une règle qui vaut pour les cinq sections : **en répartition `mensuel`, la grille prime
sur le montant annuel, et l'annuel doit en DÉCOULER** — par
`totauxAnnuelsDepuisRepartition()`, jamais par `ligne.montants` directement. Les charges et
les recettes le faisaient ; les exceptionnels et les distributions non, et leurs deux
moitiés divergeaient : le compte de résultat portait le montant saisi, la trésorerie celui
de la grille, pour un écart de bilan du montant exact de la différence — 12 000 € mesurés,
et quatre contrôles en échec. Toute nouvelle liste qui porte une `repartition` doit passer
par ces deux lignes :

```ts
const montants = totauxAnnuelsDepuisRepartition(brut, ligne.repartition, exercices);
const mensuel = repartirSurCalendrier(montants, ligne.repartition, exercices);
```

Corollaire côté interface : la grille de saisie mensuelle appelle `repartirSurExercice()`,
la fonction DU MOTEUR, pour savoir quoi afficher. Recopier la règle était la cause d'une
perte de chiffre — voir `web/src/ui/repartition.ts`.

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
   `polices/engendrer.mjs`), et **aucune n'est variable** : Chromium ne sait pas incorporer
   une police variable dans un PDF, il en dessine chaque glyphe en Type3, une procédure de
   tracé par caractère. Un fichier variable pour Hanken Grotesk faisait peser le dossier
   337 Ko au lieu de 162. Les trois faces sont des instances statiques du même fichier
   d'origine, aux mêmes métriques — 1 319 positions de texte sur 1 319 inchangées, à deux
   centièmes d'unité près. Une police appelée depuis le réseau ne serait jamais chargée.
   Le séparateur de milliers du moteur, l'espace **fine** insécable U+202F, n'existe dans
   aucune des huit faces : `pdf/nombres.ts` la remplace par U+00A0, dont l'avance vaut
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

Deux plafonds encadrent enfin l'impression : **deux Chromium à la fois** au plus, douze
demandes en attente, et **soixante secondes** par impression. `pdf/file.ts` porte les deux
mécanismes ; les trois valeurs, elles, sont au point d'appel, dans `pdf/index.ts`. Un export
coûte 450 ms et **115 Mo au-dessus** du navigateur partagé, qui pèse déjà 133 Mo. Deux
précautions, sans quoi le chiffre est faux d'un facteur deux : mesurer en PSS cumulé, la
somme des RSS comptant la mémoire partagée une fois par processus ; et mesurer la **coquille
sans tête**, celle que Playwright lance quand `CHROMIUM_PATH` est vide — le Chrome complet
pèse presque le double (242 Mo au repos, 127 de surcoût). Le plafond porte donc sur le
surcoût : deux exports demandent 360 Mo, non 230. Sans plafond, les trente que la limitation
de débit autorise par quart d'heure pouvaient partir ensemble et réclamer trois gigaoctets et
demi. Le jeton est **transmis** au premier de la file, jamais rendu puis repris : décrémenter d'abord
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
pas une image inerte. Ses **dimensions** sont lues dans son en-tête et plafonnées à 4 000
pixels de côté : le plafond du contrat porte sur le poids, et le poids ne dit rien de la
surface. Un PNG en niveaux de gris de 20 000 × 20 000 pixels, entièrement conforme, tient
en 380 Ko et faisait passer l'export de 576 ms à 29 166 — mesuré. Le logo étant persistant,
il empoisonnait ensuite tous les exports du dossier, et sur le logo du cabinet, de tous les
dossiers.

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
npm test               # 81 essais du moteur, 256 du serveur, 11 du magasin de l'interface
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

### Le quatrième point délicat : ne pas perdre une saisie

Le magasin décide de ce qui part au serveur, de ce qui est conservé et de ce qui est
remplacé. Cinq chemins y perdaient une frappe en silence, et `packages/web/test/` les
verrouille désormais un par un — c'est le revers de la première règle du projet : ne jamais
inventer un chiffre suppose de ne jamais en perdre un.

1. **Quitter n'annule pas, quitter envoie.** `fermer()` vidait la minuterie de 800 ms sans la
   déclencher : un montant tapé juste avant le clic sur « Retour à la liste » ne partait
   jamais. Il est maintenant envoyé, avec `keepalive`, y compris sur `pagehide`.
2. **Le garde de réentrance porte sur un drapeau de vol, jamais sur l'état du magasin.**
   `transformer()` repose « modifie » à chaque frappe : un garde fondé sur l'état laissait
   partir deux PUT avec la MÊME `versionAttendue`, et la réponse du premier écrasait la
   frappe faite entre-temps.
3. **La réponse d'un envoi se juge sur l'IDENTITÉ du dossier envoyé.** Si le dossier courant
   n'est plus celui qui est parti, c'est la frappe qui fait foi. Et quand rien n'a changé, on
   garde tout de même le graphe LOCAL : la réponse du serveur est un graphe entièrement neuf,
   dont l'adoption détruisait tout le partage structurel et faisait rerendre chaque grille.
   Le scénario qui distingue ce critère de l'ancien, fondé sur l'état : annuler **puis**
   rétablir pendant que le PUT est en vol — la pile de rétablissement gardant les dossiers
   par référence, le magasin retrouve l'objet exactement envoyé alors que l'état est repassé
   à « modifie », et le critère d'état reprogrammerait un second envoi identique.
4. **Le sondage relit l'état APRÈS son aller-retour.** Son garde portait sur un état vieux
   d'un GET : une frappe faite pendant le vol était remplacée par la version du serveur.
5. **Toute écriture qui suit un aller-retour porte un jeton d'ouverture.** Sans lui, une
   réponse tardive repeuplait un magasin déjà fermé et installait un intervalle orphelin.

Deux écueils propres à la **vue scindée** (`web/src/layout/`), qui ne se devinent pas :

1. **Une frontière `Suspense` par volet.** Les écrans sont chargés à la demande ; sans
   frontière propre, le premier affichage de l'un remplace toute la fenêtre par
   « Chargement… ». La coquille en pose une par volet.
2. **Les champs de saisie ne remontent qu'au `blur`.** C'est le cas de `ChampMontant`
   depuis toujours, et de `ChampTexte`, `ChampNombre` et `ChampZoneTexte` **quand ils
   portent `differe`** — ce que fait tout champ câblé au dossier, dans les cinq écrans de
   `pages/sections/`. Sans cela, un libellé de vingt caractères déclenchait vingt recalculs
   complets du prévisionnel, alors qu'aucun nombre ne bouge, et empilait vingt entrées
   d'annulation : trois libellés vidaient la pile de cinquante niveaux. Mesuré : un
   caractère passe de 7 ms à 0,20 ms, et une seule annulation restitue le libellé entier.

   Deux corollaires qu'il a fallu reprendre après coup : un champ **nu**, écrit à la main
   plutôt que pris dans `champs.tsx`, échappe à tout cela — les douze poids d'une
   saisonnalité recalculaient à chaque caractère, d'où `EntreeNombre`, qui est le corps de
   `ChampNombre` sans son enveloppe. Et un **style en ligne** bat toute feuille, règle de
   média comprise : `fontSize: 11` sur ces mêmes champs mettait le corps hors de portée de la
   règle des seize pixels. Les deux sont désormais interdits par `web/test/telephone.test.ts`.

   `differe` est en **option et non par défaut**, et la raison ne se devine pas : un
   formulaire local dont le bouton porte `disabled={!nom.trim()}` se verrouillerait. Le
   bouton reste désactivé tant que la frappe n'est pas remontée, un bouton désactivé ne
   reçoit pas de `mousedown`, donc pas de `blur` — et le champ ne remonte jamais. C'est
   exactement la modale « Nouveau dossier ».

   Corollaire : tout ce qui démonte un volet — bascule du bouton, franchissement du seuil de
   1 180 px — doit valider la frappe en cours d'abord, sans quoi la saisie revient à sa
   valeur précédente sous les yeux de l'utilisateur.

### Le cinquième point délicat : le téléphone

L'interface a été dessinée pour un écran de bureau, et n'avait qu'une seule règle de média —
celle de l'impression. Sur un téléphone, tout en-tête débordait : « Se déconnecter » sortait
de l'écran et le bouton « Nouveau dossier » devenait inatteignable. Un seul seuil, **760 px**,
porte l'adaptation ; au-delà, rien ne change.

Cinq points qui ne se devinent pas :

1. **`.rangee` ne se replie qu'en dessous du seuil**, et c'était la cause première : chaque
   en-tête de l'application en est une. Là où le repli donnerait trop de rangs — les huit
   commandes d'un dossier, les quatorze onglets d'écran —, le rang **défile** au lieu de
   s'empiler (`.actions-dossier`, `.onglets-ecrans`), avec un dégradé de fin qui le dit.
   L'onglet actif est ramené dans la vue par un calcul de `scrollLeft`, jamais par
   `scrollIntoView` : celui-ci ferait aussi défiler la page.
2. **Seize pixels pour un champ, et pas moins.** En deçà, Safari sur iOS AGRANDIT la page à
   la prise de focus et ne la réduit jamais : saisir un montant laissait l'écran zoomé.
3. **`100dvh`, jamais `100vh`** (`.hauteur-fenetre`, `.hauteur-minimale-fenetre`) : `vh`
   ignore la barre d'adresse, et la barre d'indicateurs se retrouvait dessous. Passer par la
   classe et non par un style en ligne : trois écrans avaient gardé `minHeight: '100vh'` en
   ligne, et le correctif ne s'y appliquait donc pas. `web/test/telephone.test.ts` l'interdit
   désormais.
4. **Une carte fait défiler son contenu** (`.carte { overflow-x: auto }`) plutôt que de
   pousser la page. La moitié des tableaux n'ont pas de `.defilement-horizontal` autour
   d'eux ; sur un téléphone, la liste des dossiers portait la fenêtre de mise en page de 390
   à 693 px et TOUTE l'application se retrouvait dézoomée. La règle est au conteneur pour
   qu'un tableau ajouté demain en hérite.
5. **Les champs d'une grille sont bornés en largeur.** Un `input` sans largeur explicite vaut
   vingt caractères, soit 229 px à seize de corps : les colonnes se dimensionnant sur le
   contenu, la grille des charges mesurait 1663 px dans un conteneur de 340. Bornés, 1096.

Deux seuils, et non un seul : la vue scindée demande 1 180 px, la navigation latérale 860.
Entre les deux, la colonne reste et les volets se replient.

Un piège de mise en page à connaître, qui ne concerne pas que le téléphone : une modale
centrée par une grille dont la piste n'est pas bornée se dimensionne sur son propre contenu,
et son `max-width: 100%` se résout alors contre elle — cent pour cent de 520 font 520. D'où
`grid-template-columns: minmax(0, 1fr)` sur le voile.

Et un défaut préexistant, qu'il vaut mieux connaître : `overflow-x: auto` fait de
`.defilement-horizontal` un conteneur de défilement sur **les deux** axes, de hauteur libre.
Un en-tête de tableau en `position: sticky; top: 0` s'y accroche donc et ne colle jamais.
Le calage latéral de la colonne d'intitulés, lui, fonctionne : cet axe défile vraiment.
La règle `.carte { overflow-x: auto }` du point 4 étend cette contrepartie à **toutes** les
cartes sous 760 px : c'est un échange assumé, un tableau qui déborde étant pire qu'un en-tête
qui ne colle pas.

Trois contreparties encore, qui ne se lisent pas dans le CSS :

- **Sous 760 px, l'interface retire de l'information**, elle ne fait pas que la replier :
  `.sur-grand-ecran` masque cinq colonnes de la liste des dossiers — Régime, Type, Période,
  CA du 1ᵉʳ exercice, Modifié. C'est un choix de contenu, pas de mise en page ; y ajouter une
  colonne demande de décider si elle survit au téléphone.
- **Entre 761 et 1 179 px, la bascule de vue scindée n'est plus affichée du tout**, là où
  elle l'était désactivée. La vue de bureau n'est donc « inchangée » qu'au-delà de 1 180 px.
- **Le masque de dégradé des rangs qui défilent est posé sans condition** : le dernier
  élément d'un rang court est estompé pour rien, `scroll-timeline` n'étant pas partout.

Ce qui s'éprouve sans navigateur est dans `web/test/telephone.test.ts` : le corps des champs,
la présence de la règle des seize pixels, et l'absence de tout `100vh` isolé. Le reste — pas
de débordement à sept largeurs, calage de l'onglet actif, hauteur réelle d'une cible tactile
— se regarde, comme la mise en page du PDF.

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

Douze règles à ne pas défaire :

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
7. **Changer un mot de passe — le sien — exige le mot de passe actuel, et poser une clé
   d'accès exige en plus une session de l'interface.**
   `exiger({ navigateur: true })` refuse un jeton d'API — qui vit en clair dans un fichier
   de configuration — sur le mot de passe comme sur les clés. Sans la preuve fraîche, une
   session dérobée deviendrait un accès durable qu'un changement de mot de passe ne
   refermerait pas. `PATCH /api/utilisateurs/:id` porte la même exigence lorsqu'il vise le
   compte de l'appelant, et sur le MÊME compteur que la route dédiée : deux clés distinctes
   offriraient deux budgets d'essais du même secret.

8. **Ce qu'un anonyme peut faire coûter est borné avant l'analyse du corps.** Le plafond de
   corps global vaut un mégaoctet, et non seize : la limitation de débit vit dans le
   gestionnaire, donc APRÈS l'analyse, et ne borne pas le coût d'une requête. Les **sept**
   points d'entrée joignables sans authentification refusent en outre la décompression —
   trois dans l'API, et les quatre POST d'OAuth, dont le formulaire de consentement, qui est
   justement l'étape qui crée l'identité. `@fastify/compress`, enregistré globalement, pose
   un crochet de détente sur chaque route, et 14 625 octets de gzip s'y détendaient en
   14,3 Mo — rapport de 1026 pour 1 — pour 110 à 165 ms de traitement, sur une adresse dont
   le compteur répondait déjà 429. Ne pas écrire « boucle d'événements bloquée » : la détente
   de zlib tourne dans le vivier de fils de libuv, et le retard cumulé de la boucle n'est que
   de 31 à 46 ms sur une requête isolée. C'est à la **concurrence** que l'indisponibilité se
   voit : dix bombes ensemble donnent 861 ms et 177 ms de pire retard.

   Et le plafond de corps s'applique au flux **détendu** : un `bodyLimit` serré borne donc
   l'amplification à lui seul. C'est pourquoi les routes OAuth, déjà couvertes par le
   mégaoctet global, ne coûtaient que 8 à 25 ms et non 110 ; leur plafond propre est
   maintenant à 64 Ko, celui de leur parseur de formulaire ne bornant que le formulaire. Les
   deux gardes sont éprouvés séparément dans `securite.test.ts`. Les trois routes qui portent
   un dossier ont leur propre plafond, à deux mégaoctets.
9. **Une écriture est une transaction, et l'historique de l'assistant ne se regroupe pas.**
   `ecrire()`, `creer()` et `supprimer()` passent par `enBloc` : une interruption entre
   l'UPDATE du dossier et l'archivage de sa version laissait un trou définitif dans
   l'historique, et une suppression pouvait partir sans sa trace. Le gain de vitesse est nul
   — c'est la cohérence qui est en jeu. Le regroupement de versions, lui, exige
   `auteur.origine === 'interface'` : les commentaires forgés par la surface MCP se
   répètent, si bien que quatre lots de l'assistant ne laissaient que deux versions sur cinq
   et que corriger au quatrième une erreur du deuxième n'avait plus de point de retour.
10. **L'ampleur d'un dossier est bornée dans son ensemble, à l'écriture seulement.**
   `LIGNES_MAX` est posé par LISTE, et il y a douze listes : à lui seul il laissait passer un
   dossier de vingt mégaoctets dont chaque plafond documenté était pourtant respecté.
   `verifierAmpleurDossier()` est appelée depuis `ecrire()` et `creer()`, jamais à la
   lecture — un dossier déjà en base doit rester consultable. Et l'écriture est plafonnée en
   débit comme l'export PDF l'était.

11. **Une erreur imprévue ne raconte rien de l'installation.** `app.setErrorHandler` renvoie
    tout à `repondreErreur` : quinze routes n'avaient pas de `try/catch`, et le gestionnaire
    par défaut de Fastify recopiait le message brut — « SQLITE_ERROR: no such column: x —
    /opt/previs/data/previs.db », avec le code du pilote dans le champ `code` du contrat.
    Les erreurs de transport, elles, gardent leur statut : elles ne révèlent rien.
12. **La révocation en cascade n'est atteignable que par le client concerné.** Le contrôle
    d'appartenance passe AVANT la détection du rejeu, dans `consommerCode` comme dans
    `rafraichir` : sinon, qui détient une valeur morte — un code déjà consommé traînant dans
    l'historique d'un navigateur — coupe l'accès d'un compte sans connaître aucun secret
    vivant.

`packages/core/test/securite.test.ts`, `packages/server/test/securite.test.ts`,
`packages/server/test/oauth.test.ts` et `packages/server/test/cles.test.ts` verrouillent
ces points. Un échec y signale une protection retirée, pas un chiffre qui a bougé.

Dans `cles.test.ts`, un authentificateur factice signe pour de vrai et sait aussi mal se
comporter : signer pour une autre origine, pour un autre domaine, omettre la vérification
du porteur, annoncer le porteur d'un autre compte, faire régresser son compteur. Un
contrôle qu'on ne peut pas mettre en défaut n'est pas éprouvé.

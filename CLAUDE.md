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
server/src/pdf/          document HTML imprimé par Chromium
mcp/src/outils.ts        les quinze outils exposés à l'assistant
web/src/store/dossier.ts état, recalcul, enregistrement différé, synchronisation
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

`packages/core/test/performance.test.ts` verrouille ces trois points, ainsi qu'un
plafond de cinq millisecondes par calcul sur un dossier de deux cents lignes.
Ne jamais remettre de validation dans `calculer()` : ajouter plutôt la frontière
manquante.

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
npm test               # 70 essais du moteur et du modèle, 87 essais du serveur
npm run build
```

Pour une modification du moteur, exécuter les tests est **obligatoire** : ils
vérifient l'équilibre du bilan et les contrôles de cohérence sur un dossier
complet, pour chacun des trois régimes.

Les essais de l'API (`packages/server/test/`) passent par `app.inject()` : ni port
ouvert, ni Chromium lancé, base en mémoire.

Pour une modification de l'interface, la lancer réellement : `npm run dev`, puis
parcourir les écrans touchés. Un typecheck qui passe ne prouve pas qu'un écran
s'affiche.

Pour une modification du chemin de saisie, mesurer : ouvrir un dossier d'une
soixantaine de lignes et chronométrer la tâche synchrone déclenchée par une frappe.
Elle doit rester sous six millisecondes.

## Sécurité

Mots de passe hachés par scrypt ; jetons d'API et identifiants de session stockés
en SHA-256 ; base SQLite et journaux WAL en 0600 ; limitation des tentatives de
connexion par adresse **et** par compte. Ne jamais consigner un mot de passe, un
jeton en clair ou le contenu d'un dossier dans les journaux. Le serveur refuse de
démarrer en production sans `SESSION_SECRET`.

Cinq règles à ne pas défaire :

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

`packages/core/test/securite.test.ts`, `packages/server/test/securite.test.ts` et
`packages/server/test/oauth.test.ts` verrouillent ces points. Un échec y signale une
protection retirée, pas un chiffre qui a bougé.

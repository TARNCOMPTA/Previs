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
core/src/model/          les cinq sections, l'identité, les paramètres
core/src/engine/         immobilisations, emprunts, flux, fiscal, états,
                         contrôles, et index.ts qui orchestre le tout
core/src/api/            contrat HTTP partagé et opérations atomiques
server/src/depot.ts      persistance, versions, verrouillage optimiste
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
npm test               # 46 tests du moteur
npm run build
```

Pour une modification du moteur, exécuter les tests est **obligatoire** : ils
vérifient l'équilibre du bilan et les cinq contrôles de cohérence sur un dossier
complet, pour chacun des trois régimes.

Pour une modification de l'interface, la lancer réellement : `npm run dev`, puis
parcourir les écrans touchés. Un typecheck qui passe ne prouve pas qu'un écran
s'affiche.

## Sécurité

Mots de passe hachés par scrypt, jetons d'API stockés hachés en SHA-256,
sessions opaques en base, limitation des tentatives de connexion. Ne jamais
consigner un mot de passe, un jeton en clair ou le contenu d'un dossier dans les
journaux. Le serveur refuse de démarrer en production sans `SESSION_SECRET`.

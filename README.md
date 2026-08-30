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

Créez un jeton dans **Administration → Jetons d'API**. Il n'est affiché qu'une
seule fois : seule son empreinte SHA-256 est conservée.

En HTTP, sur `/mcp`, avec l'en-tête `x-previs-token`. Ou en processus local :

```json
{
  "mcpServers": {
    "previs": {
      "command": "node",
      "args": ["/opt/previs/packages/mcp/dist/stdio.js"],
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

Chaque point est verrouillé par un essai : `packages/core/test/securite.test.ts` pour le
modèle et les opérations, `packages/server/test/securite.test.ts` pour l'API.

Le journal d'audit consigne connexions, échecs de connexion, changements de mot de
passe, créations et suppressions de comptes et de jetons, et exports PDF. Il ne
consigne jamais un mot de passe, un jeton en clair ni le contenu d'un dossier.

## Déploiement

Voir **[deploy/README-deploiement.md](deploy/README-deploiement.md)** : procédure
pas à pas sur un VPS Debian ou Ubuntu neuf, du premier SSH au certificat
Let's Encrypt, avec la sauvegarde de la base et la mise à jour.

En résumé : `docker compose up -d --build`, puis nginx en reverse-proxy HTTPS.
Tout l'état tient dans `data/previs.db`.

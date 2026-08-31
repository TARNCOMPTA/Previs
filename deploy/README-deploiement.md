# Installer Previs sur un VPS

Debian 12 ou Ubuntu 24.04, sur un serveur neuf.

## Si le serveur héberge déjà d'autres sites

C'est le cas courant, et le script est fait pour. Ce qu'il ne fait **jamais** :

| Il ne fait pas | Pourquoi c'est important |
|---|---|
| Remplacer le Node du système | Un autre site tourne peut-être sous Node 18 ou 20. Si le Node en place est trop ancien, un Node 22 est installé **pour Previs seul**, dans `/opt/previs/node`, empreinte vérifiée. |
| Activer le pare-feu | Activer ufw fermé par défaut couperait tout ce qui n'écoute pas sur 22, 80 ou 443. Le script n'y touche pas, sauf `--pare-feu` — et même alors, il n'ajoute deux règles que si ufw est **déjà actif**. |
| Retirer un hôte virtuel nginx | Y compris `default`. nginx route par nom de domaine ; la cohabitation va de soi. |
| Occuper un port pris | Il lit les ports à l'écoute et en choisit un libre entre 8080 et 8092. Le port retenu est écrit dans `.env`, puis repris tel quel aux relances. |
| Mettre à niveau des paquets | Seuls les paquets **manquants** sont installés. Un nginx en service n'est pas remplacé. |
| Toucher aux certificats existants | Le certificat est demandé pour le seul domaine indiqué, par la méthode `webroot`. |
| Démarrer un nginx que vous gardez à l'arrêt | Si `nginx.service` est inactif et que 80 ou 443 sont pris, c'est qu'un autre frontal les tient. Le script s'arrête et renvoie vers `--sans-nginx`. |

Commencez toujours par une simulation : elle dresse l'inventaire du serveur et
affiche le plan **sans rien modifier**.

```bash
sudo ./deploy/installer.sh --domaine previs.tarncompta.fr --simulation
```

## En une commande

**Avant de commencer :** l'enregistrement DNS `A` de `previs.tarncompta.fr` doit
déjà pointer vers l'adresse IP du VPS. Let's Encrypt vérifie le domaine, et le
script s'arrête net si la résolution ne mène pas à ce serveur.

```bash
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/TARNCOMPTA/Previs.git /opt/previs
cd /opt/previs
sudo ./deploy/installer.sh \
  --domaine previs.tarncompta.fr \
  --courriel contact@tarncompta.fr
```

Le script installe Node, nginx, Chromium et certbot, construit les quatre paquets,
génère la configuration et son secret de session, met le service sous systemd,
obtient le certificat, ferme le pare-feu, installe la sauvegarde quotidienne, puis
**éprouve l'installation** : santé du service, chargement de l'interface, en-têtes
de sécurité, verdict du service sur sa propre sortie PDF, et production d'un
vrai PDF de bout en bout. Il affiche à la fin le mot de passe du premier compte
administrateur.

Comptez cinq à dix minutes, l'essentiel étant la construction.

### Options

| Option | Effet |
|---|---|
| `--domaine` | Nom de domaine servi. Par défaut `previs.tarncompta.fr`. |
| `--courriel` | Adresse de notification Let's Encrypt. Obligatoire sauf `--sans-tls`. |
| `--branche` | Branche à déployer. Par défaut `main`. |
| `--racine` | Répertoire d'installation. Par défaut `/opt/previs`. |
| `--port` | Port interne imposé. Par défaut, le premier libre à partir de 8080. |
| `--sans-tls` | Reste en HTTP, sans certificat. Pour un essai en réseau local. |
| `--pare-feu` | Ouvre 80 et 443 dans ufw, **s'il est déjà actif**. Sans cette option, le pare-feu n'est pas touché. |
| `--simulation` | Inventaire et plan seulement : aucune modification. |
| `--sans-nginx` | N'installe que le service. À utiliser quand un autre frontal — conteneur, Traefik, Caddy — tient déjà 80 et 443 : le renvoi reste à votre main. |
| `--nom-vhost` | Nom du fichier d'hôte virtuel, si `previs` est déjà pris. |
| `--adopter-vhost` | Autorise la réécriture d'un hôte virtuel laissé par une exécution antérieure. |
| `--compte` | Adresse du premier compte administrateur. |

### Mettre à jour

La même commande. Le script est idempotent : il récupère la branche, reconstruit,
redémarre le service, et **ne régénère jamais un secret déjà présent** dans `.env`.

```bash
cd /opt/previs && sudo ./deploy/installer.sh \
  --domaine previs.tarncompta.fr --courriel contact@tarncompta.fr
```

### Après l'installation

1. Ouvrir `https://previs.tarncompta.fr`, se connecter avec le mot de passe affiché.
2. Le changer immédiatement, puis `sudo rm /opt/previs/premier-acces.txt`.
3. Renseigner **Administration → Identité du cabinet** : logo, SIRET, inscription
   à l'Ordre, coordonnées. C'est ce qui s'imprimera sur les dossiers remis.
4. Brancher l'assistant : pour un connecteur personnalisé de Claude, il suffit de
   l'adresse `https://previs.tarncompta.fr/mcp` — ni identifiant ni secret de client,
   voir l'étape 6. Pour Claude Code ou un appel en ligne de commande, créer un jeton
   d'API dans **Administration**.
5. Enregistrer une clé d'accès depuis **Mon compte → Clés d'accès**, sur son téléphone ou
   son ordinateur. La connexion se fait ensuite sans saisir ni adresse ni mot de passe, et
   un faux courriel menant à un site qui ressemble à Previs n'obtient rien : la clé ne
   signe que pour `previs.tarncompta.fr`. Cela suppose le service publié en **https** —
   ce que fait l'installateur ; sur une installation en clair, les clés se désactivent
   d'elles-mêmes et l'écran dit pourquoi.

### Si quelque chose cloche

```bash
sudo systemctl status previs          # état du service
sudo journalctl -u previs -n 100      # ses cent dernières lignes
sudo nginx -t                         # validité de la configuration nginx
curl -s https://previs.tarncompta.fr/api/sante
sudo /etc/cron.daily/previs-sauvegarde  # essayer la sauvegarde à la main
```

---

## Derrière un frontal en conteneur (Caddy, Traefik, nginx-proxy)

Quand un conteneur tient déjà 80 et 443, installer avec `--sans-nginx`, puis brancher
le renvoi. Pour un frontal Caddy, un second script fait les quatre gestes :

```bash
sudo ./deploy/brancher-frontal.sh --domaine previs.tarncompta.fr --simulation
sudo ./deploy/brancher-frontal.sh --domaine previs.tarncompta.fr
```

Il trouve seul le conteneur qui publie le port 443, son réseau, sa passerelle, son
sous-réseau et l'emplacement du `Caddyfile`. Il est fait pour un frontal qui dessert
d'autres sites en production : le `Caddyfile` est sauvegardé avant d'être touché, la
configuration est **validée avant tout rechargement**, et une validation en échec
restaure la sauvegarde sans jamais appeler `reload`. Le relancer ne duplique rien.

Ce qui suit décrit à la main ce qu'il fait, et vaut pour tout autre frontal. Trois
points décident du bon fonctionnement.

**1. Previs doit écouter là où le conteneur peut l'atteindre.** Pour un conteneur,
`127.0.0.1` est sa propre boucle locale, pas celle de l'hôte. Il faut donc écouter sur
une adresse visible depuis le réseau Docker :

```bash
sudo sed -i 's/^HOST=.*/HOST=0.0.0.0/' /opt/previs/.env
sudo systemctl restart previs
```

Écouter sur la passerelle du réseau (`172.18.0.1`, par exemple) serait plus étroit,
mais le service ne démarrerait plus si ce réseau était recréé avec un autre
sous-réseau. `0.0.0.0` tient dans tous les cas, la fermeture venant du pare-feu.

**2. Le pare-feu doit laisser passer le conteneur, et lui seul.** Un paquet venu d'un
conteneur vers l'hôte traverse la chaîne INPUT : avec ufw en refus par défaut, il est
rejeté sans règle explicite.

```bash
SOUS_RESEAU=$(sudo docker network inspect portail_default \
  --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')
sudo ufw allow from "$SOUS_RESEAU" to any port 8080 proto tcp comment 'frontal -> Previs'
sudo ufw deny 8080/tcp comment 'Previs jamais joignable directement'
```

L'ordre compte : ufw applique la première règle qui correspond.

**3. Le renvoi lui-même.** Pour Caddy, dans le `Caddyfile` :

```
previs.tarncompta.fr {
	reverse_proxy 172.18.0.1:8080
}
```

Caddy obtient le certificat seul, transmet `Host` tel que reçu et pose
`X-Forwarded-Proto` : les trois réglages nécessaires sont acquis par défaut. Il n'impose
pas non plus de délai de réponse, ce qui convient à l'export PDF.

```bash
sudo docker exec portail-caddy-1 caddy validate --config /etc/caddy/Caddyfile
sudo docker exec portail-caddy-1 caddy reload  --config /etc/caddy/Caddyfile
```

`caddy reload` est gracieux : les autres sites ne sont pas interrompus. Valider avant
de recharger, une configuration invalide faisant échouer le rechargement.

**Enfin, la confiance accordée au frontal.** `TRUST_PROXY=loopback` ignorerait le
`X-Forwarded-For` de Caddy, qui arrive depuis le sous-réseau Docker : la limitation des
tentatives de connexion compterait alors tous les visiteurs sur une seule adresse.

```bash
sudo sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=loopback, uniquelocal/' /opt/previs/.env
sudo systemctl restart previs
```

## Procédure détaillée, étape par étape

Ce qui suit décrit à la main ce que le script fait tout seul. À lire pour
comprendre l'installation, la reprendre partiellement, ou l'adapter.

---

## 1. Préparer le serveur

Connectez-vous en SSH, puis mettez le système à jour et créez un utilisateur
dédié — le service ne doit jamais tourner sous `root` :

```bash
sudo apt update && sudo apt upgrade -y
sudo adduser --system --group --home /opt/previs previs
```

Pointez l'enregistrement DNS `A` de votre domaine vers l'adresse IP du VPS
**avant** de demander le certificat : Let's Encrypt vérifie le domaine.

Ouvrez uniquement les ports utiles :

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Le port applicatif 8080 n'est **jamais** ouvert vers l'extérieur : nginx s'y
connecte par la boucle locale.

---

## 2. Récupérer le code

```bash
sudo apt install -y git
sudo -u previs git clone https://github.com/TARNCOMPTA/Previs.git /opt/previs
cd /opt/previs
```

---

## 3. Configurer

Copiez le modèle de configuration et générez un secret de session :

```bash
sudo -u previs cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
sudo -u previs nano .env
```

Renseignez au minimum :

| Variable | Valeur |
|---|---|
| `SESSION_SECRET` | le secret que vous venez de générer |
| `PUBLIC_URL` | `https://previs.tarncompta.fr` |
| `BOOTSTRAP_ADMIN_EMAIL` | votre adresse électronique |
| `BOOTSTRAP_ADMIN_PASSWORD` | un mot de passe long, utilisé une seule fois |
| `SECURE_COOKIES` | `true` |

Le compte administrateur n'est créé qu'au tout premier démarrage, et seulement
si la base est vide. Sans mot de passe renseigné, aucun compte n'est créé et le
service le signale dans ses journaux : mieux vaut un service inutilisable qu'un
accès ouvert. **Changez ce mot de passe depuis l'interface après la première
connexion**, puis videz la variable dans le `.env`.

---

## 4. Démarrer — avec Docker

C'est la méthode recommandée : Chromium et ses dépendances de rendu sont
installés dans l'image, rien ne dépend de l'état du système hôte.

```bash
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER   # se reconnecter ensuite
cd /opt/previs
docker compose up -d --build
docker compose logs -f
```

Vérifiez que le service répond :

```bash
curl http://127.0.0.1:8080/api/sante
```

### Sans Docker

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs chromium fonts-liberation libnss3 libatk-bridge2.0-0 \
     libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
     libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2

cd /opt/previs
sudo -u previs npm ci
sudo -u previs npm run build
sudo -u previs mkdir -p data

sudo cp deploy/previs.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now previs
sudo systemctl status previs
```

---

## 5. Publier en HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot

sudo cp deploy/nginx.previs.conf /etc/nginx/sites-available/previs
sudo nano /etc/nginx/sites-available/previs      # remplacer le nom de domaine
sudo ln -s /etc/nginx/sites-available/previs /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

Le fichier fourni référence des certificats qui n'existent pas encore. Obtenez-les
d'abord, Certbot ajustant la configuration au passage :

```bash
sudo certbot --nginx -d previs.tarncompta.fr
sudo nginx -t && sudo systemctl reload nginx
```

Le renouvellement est automatique ; vérifiez-le avec
`sudo certbot renew --dry-run`.

Ouvrez ensuite `https://previs.tarncompta.fr` et connectez-vous avec le compte
administrateur.

---

## 6. Brancher l'assistant

Trois façons de raccorder Claude, selon ce que le client sait faire.

**Par connecteur OAuth** — un connecteur personnalisé de claude.ai ou de Claude
Desktop. C'est la voie la plus simple : rien à créer d'avance.

| Champ du formulaire | Valeur |
|---|---|
| Adresse du serveur | `https://previs.tarncompta.fr/mcp` |
| ID client OAuth | *laisser vide* |
| Secret client OAuth | *laisser vide* |

Le connecteur s'enregistre de lui-même, puis ouvre un écran de consentement aux
couleurs du cabinet : on y saisit son adresse et son mot de passe Previs. L'accès vaut
alors pour ce compte, avec ses droits, et apparaît dans **Administration →
Connecteurs autorisés** — le révoquer coupe l'accès immédiatement.

Deux conditions, toutes deux remplies par l'installateur : le service doit être publié
en **https**, et `PUBLIC_URL` doit porter cette adresse https. Les métadonnées OAuth
publient `PUBLIC_URL` telle quelle, et un connecteur refuse un serveur d'autorisation en
clair. Le service prévient au démarrage si l'adresse n'est pas en https.

**En HTTP avec un jeton d'API** — Claude Code, un appel en ligne de commande. Créez le
jeton dans **Administration → Jetons d'API** ; il n'est affiché qu'une seule fois, seule
son empreinte est conservée. Adresse `https://previs.tarncompta.fr/mcp`, avec
`Authorization: Bearer previs_…` ou l'en-tête `x-previs-token`.

**En processus local**, avec le binaire fourni :

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

Un jeton donne les mêmes droits qu'un collaborateur : il peut lire et écrire
tous les dossiers, mais ni gérer les comptes ni créer d'autres jetons. Un jeton
créé depuis un compte en lecture seule ne peut rien écrire.

---

## 7. Sauvegarder

Tout l'état du logiciel tient dans un seul fichier SQLite, `data/previs.db`, avec
ses journaux `-wal` et `-shm`. Ne copiez jamais ces fichiers pendant une écriture :
utilisez la sauvegarde à chaud de SQLite, qui produit une copie cohérente.

```bash
sudo apt install -y sqlite3
sudo -u previs mkdir -p /opt/previs/sauvegardes
sudo -u previs sqlite3 /opt/previs/data/previs.db \
  ".backup '/opt/previs/sauvegardes/previs-$(date +%F).db'"
```

Automatisez-la chaque nuit, et conservez un mois d'historique :

```bash
sudo crontab -u previs -e
```

```cron
15 2 * * * sqlite3 /opt/previs/data/previs.db ".backup '/opt/previs/sauvegardes/previs-$(date +\%F).db'" && find /opt/previs/sauvegardes -name 'previs-*.db' -mtime +31 -delete
```

Recopiez ces sauvegardes hors du VPS. Une sauvegarde qui ne quitte pas la machine
ne protège de rien.

---

## 8. Mettre à jour

```bash
cd /opt/previs
sudo -u previs sqlite3 data/previs.db ".backup 'sauvegardes/avant-maj.db'"
sudo -u previs git pull

# Docker
docker compose up -d --build

# systemd
sudo -u previs npm ci && sudo -u previs npm run build
sudo systemctl restart previs
```

Les migrations de base s'appliquent au démarrage et sont idempotentes : une mise
à jour répétée ne casse rien.

---

## Dépannage

**L'export PDF échoue.** Commencez par lire le verdict que le service dépose à chaque
démarrage — il éprouve sa sortie PDF lui-même, dans son propre processus :

```bash
cat /opt/previs/data/etat-pdf        # « operationnelle » ou « indisponible » + le motif
sudo journalctl -u previs -n 60 --no-pager
```

Le motif oriente le dépannage, et il faut le lire avant de conclure :

- **« Aucun navigateur installé pour Playwright »** — les navigateurs manquent. Vérifiez
  `PLAYWRIGHT_BROWSERS_PATH` dans `.env`, ou réinstallez-les :
  `cd /opt/previs && sudo -u previs node node_modules/playwright-core/cli.js install chromium`
  avec `PLAYWRIGHT_BROWSERS_PATH=/opt/previs/chromium`.
- **« Le binaire a démarré puis s'est arrêté »** — ce n'est ni `CHROMIUM_PATH` ni le
  paquet : le binaire existe et s'exécute. La cause la plus fréquente est un
  `CHROMIUM_PATH` qui désigne le **Chrome complet** au lieu de la coquille sans affichage.
  Playwright livre les deux (`chromium-<rev>/` et `chromium_headless_shell-<rev>/`) et sait
  lequel employer ; un chemin figé le lui retire. La correction est de **vider
  `CHROMIUM_PATH`** et de laisser `PLAYWRIGHT_BROWSERS_PATH` faire son travail :

  ```bash
  sudo sed -i 's#^CHROMIUM_PATH=.*#CHROMIUM_PATH=#' /opt/previs/.env
  grep -q '^PLAYWRIGHT_BROWSERS_PATH=' /opt/previs/.env \
    || echo 'PLAYWRIGHT_BROWSERS_PATH=/opt/previs/chromium' | sudo tee -a /opt/previs/.env
  sudo systemctl restart previs && cat /opt/previs/data/etat-pdf
  ```

  Le signe caractéristique dans le journal est `chrome_crashpad_handler: --database is
  required` suivi d'un arrêt sur `SIGTRAP` : le Chrome complet ne monte pas son
  gestionnaire de plantage sous une unité cloisonnée. `CHROMIUM_PATH` ne doit porter un
  chemin que pour un vrai Chromium de distribution, sous Debian par exemple.
- Sous Docker, `shm_size` doit rester à 512 Mo : Chromium échoue silencieusement avec la
  valeur par défaut de 64 Mo.

**« Le service n'a pas pu démarrer : SESSION_SECRET est absent ».** Le refus est
volontaire : sans secret, les sessions seraient falsifiables. Générez-en un.

**Aucun compte n'existe.** Renseignez `BOOTSTRAP_ADMIN_EMAIL` et
`BOOTSTRAP_ADMIN_PASSWORD`, puis redémarrez. Le compte n'est créé que si la base
ne contient encore aucun utilisateur.

**« Le dossier a été modifié ailleurs ».** L'assistant et l'interface ont écrit
en même temps. Rien n'est perdu : rechargez, la saisie en cours est conservée.

**Consulter les journaux.** `docker compose logs -f` ou
`sudo journalctl -u previs -f`. Toutes les écritures sont par ailleurs tracées
dans la table `journal_audit` de la base.

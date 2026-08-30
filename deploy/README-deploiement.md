# Installer Previs sur un VPS

Procédure complète, du premier accès SSH à un service en production sous HTTPS.
Comptez une demi-heure. Les commandes supposent Debian 12 ou Ubuntu 24.04.

Dans tout ce document, remplacez `previs.tarncompta.fr` par votre nom de domaine.

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

Dans l'interface, ouvrez **Administration → Jetons d'API** et créez un jeton.
Il n'est affiché qu'une seule fois : seule son empreinte est conservée en base.

Deux façons de raccorder Claude :

**En HTTP**, directement sur `https://previs.tarncompta.fr/mcp`, avec l'en-tête
`x-previs-token` portant le jeton. C'est le plus simple quand le client MCP
accepte un serveur distant.

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

**L'export PDF échoue.** Chromium est introuvable ou incomplet. Vérifiez
`CHROMIUM_PATH` (`/usr/bin/chromium` sous Debian) et que le paquet est installé.
Sous Docker, `shm_size` doit rester à 512 Mo : Chromium échoue silencieusement
avec la valeur par défaut de 64 Mo.

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

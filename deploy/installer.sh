#!/usr/bin/env bash
#
# Installation de Previs sur un VPS Debian ou Ubuntu neuf.
#
#   git clone https://github.com/TARNCOMPTA/Previs.git /opt/previs
#   cd /opt/previs
#   sudo ./deploy/installer.sh --domaine previs.tarncompta.fr --courriel contact@tarncompta.fr
#
# Le script est idempotent : le relancer met le logiciel à jour sans rien perdre.
# Les secrets déjà présents dans .env ne sont jamais régénérés.
#
set -euo pipefail

# ─── Paramètres ───────────────────────────────────────────────────────────────
DOMAINE="${DOMAINE:-previs.tarncompta.fr}"
COURRIEL="${COURRIEL:-}"
RACINE="${RACINE:-/opt/previs}"
UTILISATEUR="previs"
PORT_INTERNE="8080"
BRANCHE="${BRANCHE:-main}"
SANS_TLS=0
SANS_PARE_FEU=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domaine) DOMAINE="$2"; shift 2 ;;
    --courriel) COURRIEL="$2"; shift 2 ;;
    --branche) BRANCHE="$2"; shift 2 ;;
    --racine) RACINE="$2"; shift 2 ;;
    --sans-tls) SANS_TLS=1; shift ;;
    --sans-pare-feu) SANS_PARE_FEU=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

# ─── Affichage ────────────────────────────────────────────────────────────────
etape() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
avert() { printf '  \033[33m!\033[0m %s\n' "$*"; }
mauvais() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Contrôles préalables ─────────────────────────────────────────────────────
etape "Contrôles préalables"

[[ $EUID -eq 0 ]] || mauvais "Ce script doit être lancé avec sudo."
command -v apt-get >/dev/null || mauvais "Distribution non gérée : ce script attend Debian ou Ubuntu."

# shellcheck disable=SC1091
. /etc/os-release
ok "Système : ${PRETTY_NAME:-inconnu}"

DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$DEPOT/package.json" ]] || mauvais "Le script doit être lancé depuis la copie du dépôt Previs."
ok "Dépôt : $DEPOT"

if [[ "$DEPOT" != "$RACINE" ]]; then
  avert "Le dépôt n'est pas dans $RACINE. L'unité systemd et le service utiliseront $DEPOT."
  RACINE="$DEPOT"
fi

# La résolution DNS conditionne l'émission du certificat : autant s'en assurer avant.
if [[ $SANS_TLS -eq 0 ]]; then
  IP_PUBLIQUE="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  IP_DOMAINE="$(getent ahostsv4 "$DOMAINE" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [[ -z "$IP_DOMAINE" ]]; then
    mauvais "$DOMAINE ne résout pas. Créer l'enregistrement A vers ce serveur, attendre la propagation, puis relancer.
  Relancer sans certificat : $0 --sans-tls"
  fi
  if [[ -n "$IP_PUBLIQUE" && "$IP_DOMAINE" != "$IP_PUBLIQUE" ]]; then
    mauvais "$DOMAINE pointe vers $IP_DOMAINE, alors que ce serveur est en $IP_PUBLIQUE.
  Corriger l'enregistrement A avant de poursuivre — Let's Encrypt refuserait le certificat."
  fi
  ok "$DOMAINE → $IP_DOMAINE (ce serveur)"

  if [[ -z "$COURRIEL" ]]; then
    mauvais "L'adresse de notification Let's Encrypt est obligatoire : --courriel contact@tarncompta.fr"
  fi
fi

# ─── Paquets système ──────────────────────────────────────────────────────────
etape "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git gnupg nginx openssl sqlite3 \
  fonts-liberation fonts-dejavu-core >/dev/null
ok "nginx, git, openssl, sqlite3 et les polices sont en place"

if [[ $SANS_TLS -eq 0 ]]; then
  apt-get install -y -qq --no-install-recommends certbot python3-certbot-nginx >/dev/null
  ok "certbot installé"
fi

# ─── Node.js 22 ───────────────────────────────────────────────────────────────
etape "Node.js"
VERSION_NODE="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)"
if [[ "${VERSION_NODE:-0}" -lt 20 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node --version), npm $(npm --version)"

# ─── Compte de service ────────────────────────────────────────────────────────
etape "Compte de service"
if ! id -u "$UTILISATEUR" >/dev/null 2>&1; then
  useradd --system --home-dir "$RACINE" --shell /usr/sbin/nologin "$UTILISATEUR"
fi
ok "Utilisateur système « $UTILISATEUR »"

# ─── Code et construction ─────────────────────────────────────────────────────
etape "Code et construction"
cd "$RACINE"
if [[ -d .git ]]; then
  git config --global --add safe.directory "$RACINE" 2>/dev/null || true
  git fetch --quiet origin "$BRANCHE" || avert "Impossible de contacter le dépôt distant, on garde la copie locale."
  if git rev-parse --verify --quiet "origin/$BRANCHE" >/dev/null; then
    git checkout --quiet "$BRANCHE" 2>/dev/null || git checkout --quiet -B "$BRANCHE" "origin/$BRANCHE"
    git reset --hard --quiet "origin/$BRANCHE"
    ok "Branche $BRANCHE à jour ($(git rev-parse --short HEAD))"
  fi
fi

# Chromium est fourni séparément : playwright-core ne doit pas en télécharger un
# second exemplaire pendant l'installation des dépendances.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
[[ -f packages/server/dist/index.js ]] || mauvais "La construction n'a pas produit le serveur."
[[ -f packages/web/dist/index.html ]] || mauvais "La construction n'a pas produit l'interface."
ok "Les quatre paquets sont construits"

# ─── Chromium, pour la génération des PDF ─────────────────────────────────────
etape "Chromium"
trouver_chromium() {
  local candidat
  for candidat in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome-stable /snap/bin/chromium; do
    [[ -x "$candidat" ]] && "$candidat" --version >/dev/null 2>&1 && { echo "$candidat"; return 0; }
  done
  candidat="$(find "$RACINE/chromium" \( -type f -o -type l \) -name 'chrome' 2>/dev/null | head -n1 || true)"
  [[ -n "$candidat" && -x "$candidat" ]] && { echo "$candidat"; return 0; }
  return 1
}

CHROMIUM="$(trouver_chromium || true)"
if [[ -z "$CHROMIUM" ]]; then
  apt-get install -y -qq --no-install-recommends chromium >/dev/null 2>&1 || true
  CHROMIUM="$(trouver_chromium || true)"
fi
if [[ -z "$CHROMIUM" ]]; then
  # Sous Ubuntu, le paquet « chromium » n'est qu'une coquille renvoyant vers snap :
  # playwright-core installe alors son propre Chromium, ainsi que ses dépendances.
  avert "Aucun Chromium utilisable dans la distribution. Installation par playwright-core."
  node node_modules/playwright-core/cli.js install-deps chromium >/dev/null 2>&1 || \
    avert "L'installation des dépendances de rendu a signalé une erreur ; on poursuit."
  PLAYWRIGHT_BROWSERS_PATH="$RACINE/chromium" \
    node node_modules/playwright-core/cli.js install chromium >/dev/null
  CHROMIUM="$(trouver_chromium || true)"
fi
[[ -n "$CHROMIUM" ]] || mauvais "Chromium reste introuvable : le PDF ne pourrait pas être produit."
ok "Chromium : $CHROMIUM ($("$CHROMIUM" --version 2>/dev/null | head -1))"

# ─── Configuration ────────────────────────────────────────────────────────────
etape "Configuration"
NOUVELLE_INSTALLATION=0
MOT_DE_PASSE_INITIAL=""

if [[ ! -f "$RACINE/.env" ]]; then
  NOUVELLE_INSTALLATION=1
  MOT_DE_PASSE_INITIAL="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  PROTOCOLE="https"; [[ $SANS_TLS -eq 1 ]] && PROTOCOLE="http"

  cat > "$RACINE/.env" <<CONFIG
# Configuration de Previs — produite par deploy/installer.sh
# Ce fichier porte des secrets : ne jamais le publier ni le versionner.

NODE_ENV=production
PORT=$PORT_INTERNE
HOST=127.0.0.1
PUBLIC_URL=$PROTOCOLE://$DOMAINE

# Secret de signature des cookies. Le changer déconnecte tout le monde.
SESSION_SECRET=$SECRET

DATABASE_PATH=./data/previs.db
STATIC_PATH=./packages/web/dist
CHROMIUM_PATH=$CHROMIUM

SECURE_COOKIES=$([[ $SANS_TLS -eq 1 ]] && echo false || echo true)
MCP_HTTP_ENABLED=true

# nginx est sur la boucle locale : lui seul peut déclarer l'adresse du client.
TRUST_PROXY=loopback
LOG_LEVEL=info

# Premier compte administrateur, créé au premier démarrage seulement.
BOOTSTRAP_ADMIN_EMAIL=aymeric@tarncompta.fr
BOOTSTRAP_ADMIN_PASSWORD=$MOT_DE_PASSE_INITIAL
BOOTSTRAP_ADMIN_NOM=Aymeric HANGARD
CONFIG
  ok ".env créé, secret de session généré"
else
  # Le chemin de Chromium peut changer d'une installation à l'autre ; le reste,
  # secrets compris, est laissé intact.
  if grep -q '^CHROMIUM_PATH=' "$RACINE/.env"; then
    sed -i "s#^CHROMIUM_PATH=.*#CHROMIUM_PATH=$CHROMIUM#" "$RACINE/.env"
  else
    echo "CHROMIUM_PATH=$CHROMIUM" >> "$RACINE/.env"
  fi
  ok ".env conservé (secrets inchangés), chemin de Chromium rafraîchi"
fi

chown root:"$UTILISATEUR" "$RACINE/.env"
chmod 0640 "$RACINE/.env"

install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0700 "$RACINE/data"
ok "Répertoire de données en 0700, réservé au service"

# ─── Service systemd ──────────────────────────────────────────────────────────
etape "Service systemd"
sed "s#/opt/previs#$RACINE#g" "$RACINE/deploy/previs.service" > /etc/systemd/system/previs.service
systemctl daemon-reload
systemctl enable --quiet previs
systemctl restart previs

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT_INTERNE/api/sante" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS --max-time 5 "http://127.0.0.1:$PORT_INTERNE/api/sante" >/dev/null \
  || mauvais "Le service ne répond pas. Voir : journalctl -u previs -n 50 --no-pager"
ok "Service démarré et répondant sur 127.0.0.1:$PORT_INTERNE"

# ─── nginx et certificat ──────────────────────────────────────────────────────
etape "nginx"
install -d -m 0755 /var/www/certbot
rm -f /etc/nginx/sites-enabled/default

# Première phase : un hôte virtuel en HTTP seul. Le fichier complet du dépôt
# référence des certificats qui n'existent pas encore ; nginx refuserait de démarrer.
cat > /etc/nginx/sites-available/previs <<VHOST
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAINE;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / {
        proxy_pass http://127.0.0.1:$PORT_INTERNE;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    client_max_body_size 20m;
}
VHOST
ln -sf /etc/nginx/sites-available/previs /etc/nginx/sites-enabled/previs
nginx -t >/dev/null 2>&1 || mauvais "Configuration nginx invalide : nginx -t"
systemctl reload nginx || systemctl start nginx
ok "Hôte virtuel HTTP en place pour $DOMAINE"

if [[ $SANS_TLS -eq 0 ]]; then
  etape "Certificat Let's Encrypt"
  if [[ -f "/etc/letsencrypt/live/$DOMAINE/fullchain.pem" ]]; then
    ok "Certificat déjà présent, renouvellement automatique assuré par certbot"
  else
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAINE" \
      --email "$COURRIEL" --agree-tos --no-eff-email --non-interactive \
      || mauvais "L'émission du certificat a échoué. Vérifier que le port 80 est joignable depuis Internet."
    ok "Certificat émis pour $DOMAINE"
  fi

  # Seconde phase : l'hôte virtuel complet du dépôt, avec TLS et les réglages
  # propres à l'export PDF et au point d'entrée MCP.
  sed "s/previs\.tarncompta\.fr/$DOMAINE/g" "$RACINE/deploy/nginx.previs.conf" \
    > /etc/nginx/sites-available/previs
  nginx -t >/dev/null 2>&1 || mauvais "Configuration nginx invalide après passage en HTTPS : nginx -t"
  systemctl reload nginx
  ok "HTTPS actif, redirection du port 80 en place"

  systemctl enable --quiet certbot.timer 2>/dev/null || true
fi

# ─── Pare-feu ─────────────────────────────────────────────────────────────────
if [[ $SANS_PARE_FEU -eq 0 ]]; then
  etape "Pare-feu"
  apt-get install -y -qq --no-install-recommends ufw >/dev/null
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "ufw actif : 22, 80 et 443 seulement — le port $PORT_INTERNE reste privé"
fi

# ─── Sauvegarde quotidienne ───────────────────────────────────────────────────
etape "Sauvegarde"
install -d -m 0700 "$RACINE/sauvegardes"

# La sauvegarde passe par better-sqlite3, dont le service dépend déjà, plutôt que
# par l'outil sqlite3 : une dépendance de moins, et c'est la même bibliothèque que
# celle qui écrit la base. L'API `backup()` produit un instantané cohérent, journaux
# WAL compris, sans interrompre le service.
cat > /etc/cron.daily/previs-sauvegarde <<SAUVEGARDE
#!/bin/sh
set -e
cd "$RACINE"
horodatage=\$(date +%Y%m%d-%H%M%S)
destination="$RACINE/sauvegardes/previs-\$horodatage.db"
node -e "
const Base = require('better-sqlite3');
const base = new Base(process.argv[1], { readonly: true });
base.backup(process.argv[2]).then(() => base.close());
" "$RACINE/data/previs.db" "\$destination"
gzip -f "\$destination"
chmod 0600 "\$destination.gz"
find "$RACINE/sauvegardes" -name 'previs-*.db.gz' -mtime +30 -delete
SAUVEGARDE
chmod 0700 /etc/cron.daily/previs-sauvegarde

# Un échec de sauvegarde ne doit pas faire échouer une installation par ailleurs
# terminée : le service tourne déjà, on le signale et on continue.
if /etc/cron.daily/previs-sauvegarde; then
  ok "Sauvegarde quotidienne installée, et éprouvée une fois ($(ls -1 "$RACINE/sauvegardes" | wc -l) fichier(s))"
else
  avert "La sauvegarde d'essai a échoué. Diagnostiquer : sudo /etc/cron.daily/previs-sauvegarde"
fi

# ─── Vérification de bout en bout ─────────────────────────────────────────────
etape "Vérification"
BASE_PUBLIQUE="https://$DOMAINE"; [[ $SANS_TLS -eq 1 ]] && BASE_PUBLIQUE="http://$DOMAINE"

curl -fsS --max-time 15 "$BASE_PUBLIQUE/api/sante" | grep -q operationnel \
  || mauvais "Le service ne répond pas sur $BASE_PUBLIQUE"
ok "$BASE_PUBLIQUE/api/sante répond"

curl -fsS --max-time 15 -o /dev/null "$BASE_PUBLIQUE/" \
  || mauvais "L'interface ne se charge pas sur $BASE_PUBLIQUE"
ok "L'interface se charge"

for entete in x-content-type-options content-security-policy; do
  curl -fsSI --max-time 10 "$BASE_PUBLIQUE/" | grep -qi "^$entete" \
    || avert "En-tête $entete absent de la réponse."
done
ok "En-têtes de sécurité présents"

# Chromium est la pièce la plus fragile d'une installation : on l'éprouve avec les
# mêmes arguments que le générateur de PDF, plutôt que de se fier à --version.
if sudo -u "$UTILISATEUR" env HOME=/tmp "$CHROMIUM" \
     --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
     --dump-dom about:blank >/dev/null 2>&1; then
  ok "Chromium démarre sous le compte de service"
else
  mauvais "Chromium ne démarre pas sous le compte « $UTILISATEUR » : l'export PDF échouerait.
  Essayer : sudo -u $UTILISATEUR $CHROMIUM --headless=new --no-sandbox --dump-dom about:blank"
fi

# Sur une première installation, on connaît les identifiants : on produit un vrai
# PDF de bout en bout, puis on efface le dossier d'essai.
if [[ $NOUVELLE_INSTALLATION -eq 1 ]]; then
  BISCUITS="$(mktemp)"
  if curl -fsS --max-time 20 -c "$BISCUITS" -X POST "$BASE_PUBLIQUE/api/auth/connexion" \
       -H 'content-type: application/json' \
       -d "{\"email\":\"aymeric@tarncompta.fr\",\"motDePasse\":\"$MOT_DE_PASSE_INITIAL\"}" \
       -o /dev/null; then
    # Le corps de la réponse porte le dossier entier, où chaque ligne a son propre
    # « id » : il faut l'analyser, pas y chercher un motif.
    IDENTIFIANT="$(curl -fsS --max-time 20 -b "$BISCUITS" -X POST "$BASE_PUBLIQUE/api/dossiers" \
      -H 'content-type: application/json' -H "origin: $BASE_PUBLIQUE" \
      -d '{"nom":"Essai d’installation","modele":"IS"}' \
      | node -e 'let t="";process.stdin.on("data",c=>t+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(t).id??""))}catch{}})')"
    if [[ -n "$IDENTIFIANT" ]]; then
      PDF="$(mktemp)"
      if curl -fsS --max-time 120 -b "$BISCUITS" -X POST \
           "$BASE_PUBLIQUE/api/dossiers/$IDENTIFIANT/pdf" -H "origin: $BASE_PUBLIQUE" -o "$PDF"; then
        TAILLE="$(wc -c < "$PDF")"
        if [[ "$TAILLE" -gt 20000 ]] && head -c 4 "$PDF" | grep -q '%PDF'; then
          ok "Export PDF éprouvé de bout en bout ($((TAILLE / 1024)) Ko)"
        else
          avert "Le PDF produit fait $TAILLE octets et ne ressemble pas à un PDF. Voir : journalctl -u previs -n 50"
        fi
      else
        avert "L'export PDF a échoué. Voir : journalctl -u previs -n 50"
      fi
      rm -f "$PDF"
      curl -fsS --max-time 20 -b "$BISCUITS" -X DELETE \
        "$BASE_PUBLIQUE/api/dossiers/$IDENTIFIANT" -H "origin: $BASE_PUBLIQUE" -o /dev/null \
        || avert "Le dossier d'essai « $IDENTIFIANT » n'a pas pu être supprimé ; le retirer à la main."
    else
      avert "Le dossier d'essai n'a pas pu être créé ; l'export PDF n'a pas été éprouvé."
    fi
  else
    avert "Connexion d'essai impossible ; l'export PDF n'a pas été éprouvé."
  fi
  rm -f "$BISCUITS"
fi

# ─── Récapitulatif ────────────────────────────────────────────────────────────
printf '\n\033[1;32m════ Previs est installé ════\033[0m\n\n'
printf '  Adresse          %s\n' "$BASE_PUBLIQUE"
printf '  Point MCP        %s/mcp\n' "$BASE_PUBLIQUE"
printf '  Base de données  %s/data/previs.db\n' "$RACINE"
printf '  Sauvegardes      %s/sauvegardes/ (quotidiennes, 30 jours)\n' "$RACINE"
printf '  Journal          journalctl -u previs -f\n'
printf '  Mise à jour      cd %s && sudo ./deploy/installer.sh --domaine %s --courriel %s\n' \
  "$RACINE" "$DOMAINE" "${COURRIEL:-…}"

if [[ $NOUVELLE_INSTALLATION -eq 1 ]]; then
  # Le compte existe maintenant en base : le mot de passe d'amorçage n'a plus
  # d'utilité pour le service et n'a rien à faire dans un fichier qu'il peut lire.
  sed -i 's/^BOOTSTRAP_ADMIN_PASSWORD=.*/BOOTSTRAP_ADMIN_PASSWORD=/' "$RACINE/.env"
  printf '%s\n' \
    "Premier accès à Previs — $BASE_PUBLIQUE" \
    "Adresse      : aymeric@tarncompta.fr" \
    "Mot de passe : $MOT_DE_PASSE_INITIAL" \
    "" \
    "À changer dès la première connexion, puis supprimer ce fichier :" \
    "  sudo rm $RACINE/premier-acces.txt" \
    > "$RACINE/premier-acces.txt"
  chown root:root "$RACINE/premier-acces.txt"
  chmod 0600 "$RACINE/premier-acces.txt"

  printf '\n\033[1;33m  ── Premier compte administrateur ──\033[0m\n'
  printf '  Adresse        aymeric@tarncompta.fr\n'
  printf '  Mot de passe   \033[1m%s\033[0m\n' "$MOT_DE_PASSE_INITIAL"
  printf '\n  \033[33mIl a été retiré de .env et recopié dans %s/premier-acces.txt,\n' "$RACINE"
  printf '  lisible par root seul. Le changer à la première connexion, puis supprimer ce fichier.\033[0m\n'
fi

printf '\n  Prochaine étape : ouvrir %s, se connecter, puis renseigner\n' "$BASE_PUBLIQUE"
printf '  Administration → Identité du cabinet (logo, SIRET, inscription à l’Ordre).\n\n'

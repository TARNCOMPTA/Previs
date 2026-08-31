#!/usr/bin/env bash
#
# Installation de Previs sur un VPS Debian ou Ubuntu.
#
#   git clone https://github.com/TARNCOMPTA/Previs.git /opt/previs
#   cd /opt/previs
#   sudo ./deploy/installer.sh --domaine previs.tarncompta.fr --courriel contact@tarncompta.fr
#
# Le script est idempotent : le relancer met le logiciel à jour sans rien perdre.
# Les secrets déjà présents dans .env ne sont jamais régénérés.
#
# COHABITATION AVEC D'AUTRES SITES
#
# Le script est conçu pour un serveur qui héberge déjà autre chose. Il ne touche
# jamais au Node du système, n'active jamais le pare-feu de lui-même, ne retire
# aucun hôte virtuel nginx, et choisit un port libre s'il en trouve un occupé.
# Lancer d'abord --simulation pour voir l'inventaire et le plan sans rien modifier.
#
set -euo pipefail

# ─── Paramètres ───────────────────────────────────────────────────────────────
DOMAINE="${DOMAINE:-previs.tarncompta.fr}"
COURRIEL="${COURRIEL:-}"
RACINE="${RACINE:-/opt/previs}"
BOOTSTRAP_COURRIEL="${BOOTSTRAP_COURRIEL:-aymeric@tarncompta.fr}"
NOM_VHOST="${NOM_VHOST:-previs}"
ADOPTER_VHOST=0
# Sur un serveur où un autre frontal — conteneur, Traefik, Caddy — tient 80 et 443,
# Previs se contente de tourner sur son port ; le renvoi reste à l'exploitant.
SANS_NGINX=0
# Marque apposée dans les fichiers que ce script écrit : elle seule l'autorise à
# les réécrire. Tout fichier qui ne la porte pas appartient à quelqu'un d'autre.
MARQUE="# Généré par Previs — deploy/installer.sh. Ne pas modifier à la main."
UTILISATEUR="previs"
PORT_INTERNE="${PORT_INTERNE:-}"
# La branche extraite fait foi : viser « main » en dur échouait sur une copie posée
# sur une branche de travail, et le script perdait alors sa mise à jour.
BRANCHE="${BRANCHE:-}"
SANS_TLS=0
# Le pare-feu est en adhésion volontaire : l'activer sur un serveur qui héberge
# d'autres services couperait tout ce qui n'écoute pas sur 22, 80 ou 443.
PARE_FEU=0
SIMULATION=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domaine) DOMAINE="$2"; shift 2 ;;
    --courriel) COURRIEL="$2"; shift 2 ;;
    --compte) BOOTSTRAP_COURRIEL="$2"; shift 2 ;;
    --nom-vhost) NOM_VHOST="$2"; shift 2 ;;
    --adopter-vhost) ADOPTER_VHOST=1; shift ;;
    --sans-nginx) SANS_NGINX=1; SANS_TLS=1; shift ;;
    --branche) BRANCHE="$2"; shift 2 ;;
    --racine) RACINE="$2"; shift 2 ;;
    --port) PORT_INTERNE="$2"; shift 2 ;;
    --sans-tls) SANS_TLS=1; shift ;;
    --pare-feu) PARE_FEU=1; shift ;;
    --simulation) SIMULATION=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

# ─── Affichage ────────────────────────────────────────────────────────────────
etape() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
avert() { printf '  \033[33m!\033[0m %s\n' "$*"; }
mauvais() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Un obstacle arrête une exécution réelle, mais se contente de signaler en simulation :
# un inventaire qui s'interrompt au premier problème ne montre pas les suivants.
if [[ $SIMULATION -eq 1 ]]; then
  obstacle() { avert "$@"; }
else
  obstacle() { mauvais "$@"; }
fi

# ─── Sauvegarde de la base ────────────────────────────────────────────────────
# Passe par better-sqlite3, dont le service dépend déjà : c'est la même bibliothèque
# que celle qui écrit la base, et l'API backup() produit un instantané cohérent,
# journaux WAL compris, sans interrompre le service.
sauvegarder_base() {
  local base="$1" destination="$2" moteur="${3:-node}"
  [[ -f "$base" ]] || return 1
  "$moteur" -e "
    const Base = require('better-sqlite3');
    const base = new Base(process.argv[1], { readonly: true });
    base.backup(process.argv[2]).then(() => base.close());
  " "$base" "$destination"
}

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

# L'unité porte ProtectHome=true, qui rend /home, /root et /run/user vides pour le
# service : une installation posée là donnerait une unité incapable de démarrer
# (status=226/NAMESPACE). Autant le dire avant d'avoir touché à quoi que ce soit.
case "$DEPOT/" in
  /home/*|/root/*|/run/user/*)
    mauvais "Le dépôt est dans $DEPOT. L'unité systemd interdit au service l'accès à /home,
  /root et /run/user — cloisonnement voulu — et il ne démarrerait jamais depuis là.
  Installer sous /opt ou /srv :
    sudo git clone https://github.com/TARNCOMPTA/Previs.git /opt/previs
    cd /opt/previs && sudo ./deploy/installer.sh …" ;;
esac

if [[ "$DEPOT" != "$RACINE" ]]; then
  # Réorienter RACINE en silence rendait --racine inopérant, et pouvait faire repartir
  # le service sur un autre répertoire de données que celui attendu. On refuse.
  mauvais "Le dépôt est dans $DEPOT, alors que l'installation viserait $RACINE.
  Le service, sa base et ses sauvegardes doivent vivre là où est le dépôt.
  Soit lancer le script depuis $RACINE, soit viser le dépôt : --racine $DEPOT"
fi

# La résolution DNS conditionne l'émission du certificat : autant s'en assurer avant.
# En simulation, rien n'est émis : un problème est signalé, il n'arrête pas l'inventaire.
if [[ $SANS_TLS -eq 0 ]]; then
  IP_PUBLIQUE="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  IP_DOMAINE="$(getent ahostsv4 "$DOMAINE" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [[ -z "$IP_DOMAINE" ]]; then
    obstacle "$DOMAINE ne résout pas. Créer l'enregistrement A vers ce serveur, attendre la propagation, puis relancer.
  Relancer sans certificat : $0 --sans-tls"
  elif [[ -n "$IP_PUBLIQUE" && "$IP_DOMAINE" != "$IP_PUBLIQUE" ]]; then
    obstacle "$DOMAINE pointe vers $IP_DOMAINE, alors que ce serveur est en $IP_PUBLIQUE.
  Corriger l'enregistrement A avant de poursuivre — Let's Encrypt refuserait le certificat."
  else
    ok "$DOMAINE → $IP_DOMAINE (ce serveur)"
  fi

  # Le courriel ne sert qu'à l'émission du certificat : il n'est pas requis pour
  # dresser l'inventaire du serveur.
  if [[ -z "$COURRIEL" ]]; then
    obstacle "L'adresse de notification Let's Encrypt est obligatoire : --courriel contact@tarncompta.fr"
  fi
fi

# ─── Inventaire du serveur ────────────────────────────────────────────────────
# Ce serveur héberge peut-être déjà des sites : avant de rien modifier, on montre
# ce qui existe et on choisit des réglages qui n'y touchent pas.
etape "Ce qui tourne déjà sur ce serveur"

NGINX_ACTIF=0
systemctl is-active --quiet nginx 2>/dev/null && NGINX_ACTIF=1

if command -v nginx >/dev/null; then
  if [[ $NGINX_ACTIF -eq 1 ]]; then
    ok "nginx en service ($(nginx -v 2>&1 | sed 's#.*/##'))"
  else
    avert "nginx installé ($(nginx -v 2>&1 | sed 's#.*/##')) mais son service n'est PAS actif"
  fi
  HOTES="$(ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | tr '\n' ' ' || true)"
  [[ -n "${HOTES// }" ]] && avert "Hôtes virtuels actifs, laissés intacts : $HOTES"
else
  avert "nginx absent, il sera installé"
fi

# Les ports à l'écoute sont lus dans /proc : ni ss (iproute2) ni strtonum (absent
# de l'awk de Debian) ne sont supposés présents. La conversion se fait en bash.
TABLES_TCP=()
for fichier in /proc/net/tcp /proc/net/tcp6; do
  [[ -r "$fichier" ]] && TABLES_TCP+=("$fichier")
done

ECOUTES=""
for fichier in "${TABLES_TCP[@]}"; do
  while read -r hexa; do
    [[ -n "$hexa" ]] && ECOUTES="$ECOUTES $((16#$hexa))"
  done < <(awk 'FNR > 1 && $4 == "0A" { split($2, a, ":"); print a[2] }' "$fichier")
done
if [[ -n "${ECOUTES// }" ]]; then
  # shellcheck disable=SC2086
  avert "Ports déjà à l'écoute, non touchés : $(printf '%s\n' $ECOUTES | sort -un | tr '\n' ' ')"
fi


[[ ${#TABLES_TCP[@]} -gt 0 ]] \
  || avert "Impossible de lire /proc/net/tcp : les collisions de port ne seront pas détectées.
    Imposer un port libre avec --port."

ETAT_UFW="absent"
command -v ufw >/dev/null && ETAT_UFW="$(ufw status 2>/dev/null | head -1 | sed 's/^Status: //')"
ok "Pare-feu ufw : $ETAT_UFW"

if [[ -d /etc/letsencrypt/live ]]; then
  CERTS="$(ls -1 /etc/letsencrypt/live 2>/dev/null | tr '\n' ' ' || true)"
  [[ -n "${CERTS// }" ]] && avert "Certificats existants, non touchés : $CERTS"
fi

NODE_SYSTEME="$(command -v node 2>/dev/null || true)"
if [[ -n "$NODE_SYSTEME" ]]; then
  ok "Node du système : $("$NODE_SYSTEME" --version) ($NODE_SYSTEME) — il ne sera jamais remplacé"
else
  avert "Aucun Node sur le système"
fi

# ─── Choix d'un port libre ────────────────────────────────────────────────────
# La lecture passe par /proc, toujours présent sous Linux, plutôt que par ss.
# Un fichier absent — /proc/net/tcp6 sur un serveur sans IPv6 — ne doit pas faire
# conclure « port libre » : seules les tables réellement lisibles sont examinées.
port_occupe() {
  local hexa
  hexa="$(printf '%04X' "$1")"
  [[ ${#TABLES_TCP[@]} -gt 0 ]] || return 1
  awk -v p="$hexa" \
    'FNR > 1 && $4 == "0A" { split($2, a, ":"); if (a[2] == p) trouve = 1 }
     END { exit !trouve }' "${TABLES_TCP[@]}"
}

PORT_EXISTANT=""
[[ -f "$RACINE/.env" ]] && PORT_EXISTANT="$(sed -n 's/^PORT=\([0-9]\+\)$/\1/p' "$RACINE/.env" | head -1)"

if [[ -n "$PORT_INTERNE" ]]; then
  # Port imposé : il ne doit être occupé par personne d'autre que Previs lui-même.
  if [[ "$PORT_INTERNE" != "$PORT_EXISTANT" ]] && port_occupe "$PORT_INTERNE"; then
    mauvais "Le port $PORT_INTERNE demandé est déjà occupé par un autre service."
  fi
elif [[ -n "$PORT_EXISTANT" ]]; then
  # Relance : on garde le port déjà configuré. Le détecter à nouveau le trouverait
  # occupé — par Previs — et en choisirait un autre, désaccordant .env et nginx.
  #
  # Encore faut-il que ce soit bien Previs qui l'occupe. Sur un serveur partagé, un
  # .env peut désigner un port entre-temps pris par un autre service : nginx
  # renverrait alors previs.tarncompta.fr vers celui-là.
  if port_occupe "$PORT_EXISTANT"; then
    REPONSE="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT_EXISTANT/api/sante" 2>/dev/null || true)"
    case "$REPONSE" in
      *'"service":"previs"'*) ok "Port $PORT_EXISTANT repris de la configuration : c'est bien Previs qui l'occupe" ;;
      *)
        mauvais "Le port $PORT_EXISTANT figure dans $RACINE/.env, mais il est occupé par un service
  qui n'est pas Previs — sa réponse à /api/sante : ${REPONSE:-aucune}.
  Poursuivre ferait renvoyer $DOMAINE vers ce service.
  Identifier l'occupant :  sudo ss -ltnp | grep :$PORT_EXISTANT
  Puis choisir un autre port :  $0 --port 8081 …" ;;
    esac
  else
    ok "Port repris de la configuration en place : $PORT_EXISTANT"
  fi
  PORT_INTERNE="$PORT_EXISTANT"
else
  for candidat in 8080 8081 8082 8083 8084 8090 8091 8092; do
    if ! port_occupe "$candidat"; then PORT_INTERNE="$candidat"; break; fi
  done
  [[ -n "$PORT_INTERNE" ]] || mauvais "Aucun port libre trouvé entre 8080 et 8092. En imposer un avec --port."
fi
ok "Previs écoutera sur 127.0.0.1:$PORT_INTERNE, jamais exposé directement"

# ─── Qui sert les ports publics ? ─────────────────────────────────────────────
# Le paquet nginx peut être installé sans que son service tienne 80 et 443 : un
# conteneur, Traefik ou Caddy peut les avoir pris. Toucher à nginx.service serait
# alors inutile au mieux, et tenter de le démarrer échouerait sur un port déjà lié.
if [[ $SANS_NGINX -eq 0 && $NGINX_ACTIF -eq 0 ]] && { port_occupe 80 || port_occupe 443; }; then
  obstacle "Les ports publics sont occupés, mais nginx.service n'est pas actif : un autre serveur
    frontal les tient — un conteneur Docker, Traefik, Caddy, Apache.
    Identifier lequel :  sudo ss -ltnp | grep -E ':80 |:443 '
    Le script ne peut ni recharger ni démarrer nginx dans cette situation. Installer Previs
    seul, et brancher le renvoi vous-même sur votre frontal :
                         $0 --sans-nginx …"
fi

# ─── Ce qui appartient déjà à quelqu'un d'autre ───────────────────────────────
# Ces contrôles doivent figurer dans l'inventaire : une simulation ne servirait à rien
# si elle affichait un plan vert pour une exécution qui s'arrête à mi-chemin.
VHOST="/etc/nginx/sites-available/$NOM_VHOST"
if [[ ! -f "$VHOST" ]] || grep -qF "$MARQUE" "$VHOST"; then
  ok "Hôte virtuel à écrire : $VHOST"
elif [[ $ADOPTER_VHOST -eq 1 ]]; then
  avert "Hôte virtuel $VHOST repris sur demande explicite (--adopter-vhost)."
elif grep -qF 'location /.well-known/acme-challenge/ { root /var/www/certbot; }' "$VHOST" \
     && grep -qE "^[[:space:]]*server_name[[:space:]]+$DOMAINE;" "$VHOST" \
     && grep -qE 'proxy_pass http://127\.0\.0\.1:[0-9]+;' "$VHOST"; then
  # Les versions antérieures de ce script n'apposaient pas encore de marque. Leur
  # hôte virtuel de phase 1 est reconnaissable, mais on ne l'écrase pas de soi-même :
  # c'est à l'exploitant de confirmer qu'il n'a pas d'autre origine.
  obstacle "$VHOST ressemble à l'hôte virtuel de phase 1 qu'une version antérieure de cet
    installateur écrivait — même domaine, même défi ACME, même mandataire local. Il ne porte
    pas encore la marque introduite depuis, donc le script ne le réécrit pas de lui-même.
    Le vérifier :  sudo cat $VHOST
    S'il vient bien d'une installation antérieure de Previs, le reprendre :
                   $0 --adopter-vhost …"
else
  obstacle "$VHOST existe déjà et n'a pas été écrit par cet installateur.
    L'écraser mettrait hors service le site qu'il dessert.
    L'examiner :   sudo cat $VHOST
    Puis soit le retirer, soit installer sous un autre nom :
                   $0 --nom-vhost previs-financier …"
fi

# -R et non -r : sites-enabled ne contient que des liens symboliques, que -r n'ouvre pas.
# Le contrôle ne détectait donc jamais rien.
AUTRE="$(grep -RlE "^[[:space:]]*server_name([[:space:]]|.*[[:space:]])$DOMAINE[[:space:];]" \
  /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "/$NOM_VHOST\$" | tr '\n' ' ' || true)"
if [[ -n "${AUTRE// }" ]]; then
  obstacle "$DOMAINE est déjà servi par un autre hôte virtuel : $AUTRE
    Deux déclarations du même nom de domaine se disputeraient les requêtes.
    Retirer l'ancienne, ou choisir un autre domaine pour Previs."
fi

# ─── Plan, et sortie en simulation ────────────────────────────────────────────
if [[ $SIMULATION -eq 1 ]]; then
  etape "Plan — rien n'a été modifié"
  printf '  Ce que le script ferait :\n'
  printf '   • installer les paquets manquants (nginx, git, openssl, polices%s)\n' \
    "$([[ $SANS_TLS -eq 0 ]] && echo ', certbot')"
  if [[ -z "$NODE_SYSTEME" ]] || [[ "$(printf '%s' "${NODE_SYSTEME:+$("$NODE_SYSTEME" --version)}" | sed 's/^v//' | cut -d. -f1)" -lt 20 ]] 2>/dev/null; then
    printf '   • installer un Node 22 PRIVÉ dans %s/node — le Node du système reste intact\n' "$RACINE"
  else
    printf '   • réutiliser le Node du système, sans y toucher\n'
  fi
  printf '   • créer le compte système « %s » et construire les quatre paquets\n' "$UTILISATEUR"
  printf '   • écrire /etc/systemd/system/previs.service et démarrer le service sur 127.0.0.1:%s\n' "$PORT_INTERNE"
  if [[ $SANS_NGINX -eq 1 ]]; then
    printf '   • ne PAS toucher au serveur frontal — le renvoi vers 127.0.0.1:%s reste à faire\n' "$PORT_INTERNE"
  else
    printf '   • ajouter /etc/nginx/sites-available/%s pour %s — aucun autre hôte virtuel touché\n' "$NOM_VHOST" "$DOMAINE"
  fi
  [[ $SANS_TLS -eq 0 ]] && printf '   • obtenir un certificat pour %s seulement\n' "$DOMAINE"
  if [[ $PARE_FEU -eq 1 ]]; then
    printf '   • ouvrir 80 et 443 dans ufw (sans activer le pare-feu s’il est inactif)\n'
  else
    printf '   • ne PAS toucher au pare-feu\n'
  fi
  printf '   • installer /etc/cron.daily/previs-sauvegarde\n'
  printf '\n  Relancer sans --simulation pour exécuter.\n\n'
  exit 0
fi

# ─── Paquets système ──────────────────────────────────────────────────────────
etape "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Seuls les paquets manquants sont installés : rien n'est mis à niveau sous les
# pieds d'un autre site, et nginx en service n'est pas remplacé.
A_INSTALLER=""
for paquet in ca-certificates curl git gnupg nginx openssl sqlite3 xz-utils \
              fonts-liberation fonts-dejavu-core; do
  dpkg -s "$paquet" >/dev/null 2>&1 || A_INSTALLER="$A_INSTALLER $paquet"
done
if [[ $SANS_TLS -eq 0 ]]; then
  for paquet in certbot python3-certbot-nginx; do
    dpkg -s "$paquet" >/dev/null 2>&1 || A_INSTALLER="$A_INSTALLER $paquet"
  done
fi

if [[ -n "${A_INSTALLER// }" ]]; then
  # shellcheck disable=SC2086
  apt-get install -y -qq --no-install-recommends $A_INSTALLER >/dev/null
  ok "Paquets ajoutés :${A_INSTALLER}"
else
  ok "Tous les paquets nécessaires étaient déjà là — rien n'a été installé"
fi

# ─── Node.js ──────────────────────────────────────────────────────────────────
#
# Le Node du système n'est JAMAIS remplacé : un autre site du serveur en dépend
# peut-être. S'il est trop ancien, un Node 22 est installé pour Previs seul, dans
# son propre répertoire, et c'est celui-là que l'unité systemd appellera.
etape "Node.js"
VERSION_NODE=0
[[ -n "$NODE_SYSTEME" ]] && VERSION_NODE="$("$NODE_SYSTEME" --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"

if [[ "${VERSION_NODE:-0}" -ge 20 ]]; then
  NODE="$NODE_SYSTEME"
  ok "Node du système réutilisé tel quel : $("$NODE" --version)"
else
  NODE_PRIVE="$RACINE/node"
  if [[ -x "$NODE_PRIVE/bin/node" ]] \
     && [[ "$("$NODE_PRIVE/bin/node" --version | sed 's/^v//' | cut -d. -f1)" -ge 20 ]]; then
    ok "Node privé déjà installé : $("$NODE_PRIVE/bin/node" --version)"
  else
    case "$(uname -m)" in
      x86_64) ARCHI="x64" ;;
      aarch64|arm64) ARCHI="arm64" ;;
      *) mauvais "Architecture $(uname -m) non gérée. Installer Node 20 ou plus, puis relancer." ;;
    esac
    avert "Node absent ou trop ancien (${VERSION_NODE:-aucun}) : installation privée dans $NODE_PRIVE."

    INDEX="https://nodejs.org/download/release/latest-v22.x"
    TEMPO="$(mktemp -d)"
    curl -fsSL "$INDEX/SHASUMS256.txt" -o "$TEMPO/SHASUMS256.txt" \
      || mauvais "Impossible de récupérer la liste des empreintes Node."
    ARCHIVE="$(awk -v a="linux-$ARCHI.tar.xz" '$2 ~ a {print $2}' "$TEMPO/SHASUMS256.txt" | head -1)"
    [[ -n "$ARCHIVE" ]] || mauvais "Aucune archive Node pour linux-$ARCHI."
    curl -fsSL "$INDEX/$ARCHIVE" -o "$TEMPO/$ARCHIVE" || mauvais "Téléchargement de Node échoué."
    # Un binaire téléchargé se vérifie : on contrôle l'empreinte publiée.
    ( cd "$TEMPO" && grep " $ARCHIVE\$" SHASUMS256.txt | sha256sum -c --quiet - ) \
      || mauvais "L'empreinte de $ARCHIVE ne correspond pas. Téléchargement rejeté."
    rm -rf "$NODE_PRIVE"
    install -d -m 0755 "$NODE_PRIVE"
    tar -xJf "$TEMPO/$ARCHIVE" -C "$NODE_PRIVE" --strip-components=1
    rm -rf "$TEMPO"
    ok "Node privé installé : $("$NODE_PRIVE/bin/node" --version) (empreinte vérifiée)"
  fi
  NODE="$NODE_PRIVE/bin/node"
  # npm et npx du même paquet doivent primer, sans polluer le PATH du système.
  export PATH="$NODE_PRIVE/bin:$PATH"
fi
ok "Node retenu pour Previs : $NODE ($("$NODE" --version)), npm $(npm --version)"

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
  [[ -n "$BRANCHE" ]] || BRANCHE="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  git fetch --quiet origin "$BRANCHE" || avert "Impossible de contacter le dépôt distant, on garde la copie locale."
  if git rev-parse --verify --quiet "origin/$BRANCHE" >/dev/null; then
    git checkout --quiet "$BRANCHE" 2>/dev/null || git checkout --quiet -B "$BRANCHE" "origin/$BRANCHE"
    git reset --hard --quiet "origin/$BRANCHE"
    ok "Branche $BRANCHE à jour ($(git rev-parse --short HEAD))"
  fi
fi

# Une relance reconstruit le code et redémarre le service : au prochain démarrage, les
# migrations s'appliquent à une base qui contient peut-être déjà des dossiers clients.
# On en prend copie AVANT, jamais après.
BASE_EXISTANTE="$RACINE/data/previs.db"
if [[ -f "$BASE_EXISTANTE" ]]; then
  install -d -m 0700 "$RACINE/sauvegardes"
  AVANT_MAJ="$RACINE/sauvegardes/avant-mise-a-jour-$(date +%Y%m%d-%H%M%S).db"
  if sauvegarder_base "$BASE_EXISTANTE" "$AVANT_MAJ" "$NODE" 2>/dev/null \
     || sauvegarder_base "$BASE_EXISTANTE" "$AVANT_MAJ" node 2>/dev/null; then
    gzip -f "$AVANT_MAJ"
    chmod 0600 "$AVANT_MAJ.gz"
    ok "Base sauvegardée avant mise à jour : $(basename "$AVANT_MAJ").gz ($(du -h "$AVANT_MAJ.gz" | cut -f1))"
  else
    # Refuser plutôt que reconstruire sur une base dont on n'a pas de copie.
    mauvais "La base $BASE_EXISTANTE existe mais n'a pas pu être sauvegardée.
  Reconstruire appliquerait des migrations à des dossiers clients sans filet.
  Diagnostiquer, ou copier la base à la main, puis relancer :
    sudo cp -a $RACINE/data $RACINE/data.copie-$(date +%Y%m%d)"
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
if [[ -z "$CHROMIUM" && "${ID:-}" == "debian" ]]; then
  # Sous Debian seulement : le paquet chromium est un vrai binaire. Sous Ubuntu ce
  # n'est qu'une coquille qui entraînerait snapd sur un serveur qui n'en a pas.
  apt-get install -y -qq --no-install-recommends chromium >/dev/null 2>&1 || true
  CHROMIUM="$(trouver_chromium || true)"
fi
if [[ -z "$CHROMIUM" ]]; then
  # Sous Ubuntu, le paquet « chromium » n'est qu'une coquille renvoyant vers snap :
  # playwright-core installe alors son propre Chromium, ainsi que ses dépendances.
  avert "Aucun Chromium utilisable dans la distribution. Installation par playwright-core."
  "$NODE" node_modules/playwright-core/cli.js install-deps chromium >/dev/null 2>&1 || \
    avert "L'installation des dépendances de rendu a signalé une erreur ; on poursuit."
  PLAYWRIGHT_BROWSERS_PATH="$RACINE/chromium" \
    "$NODE" node_modules/playwright-core/cli.js install chromium >/dev/null
  CHROMIUM="$(trouver_chromium || true)"
fi
[[ -n "$CHROMIUM" ]] || mauvais "Chromium reste introuvable : le PDF ne pourrait pas être produit."

# `playwright install-deps` s'appuie sur une table de noms de version ; sur une
# distribution trop récente il ne reconnaît rien et n'installe rien. On vérifie donc
# que le binaire démarre, et à défaut on pose les bibliothèques de rendu nommément.
if ! "$CHROMIUM" --headless=new --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1; then
  avert "Chromium ne démarre pas encore : installation des bibliothèques de rendu."
  BIBLIOTHEQUES=""
  for paquet in libnss3 libnspr4 libatk1.0-0t64 libatk1.0-0 libatk-bridge2.0-0t64 \
                libatk-bridge2.0-0 libcups2t64 libcups2 libdrm2 libxkbcommon0 \
                libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
                libasound2t64 libasound2 libpango-1.0-0 libcairo2 libx11-xcb1; do
    # Les paquets à suffixe t64 ont remplacé les anciens : on ne demande que ceux
    # que la distribution connaît réellement.
    if ! dpkg -s "$paquet" >/dev/null 2>&1 && apt-cache show "$paquet" >/dev/null 2>&1; then
      BIBLIOTHEQUES="$BIBLIOTHEQUES $paquet"
    fi
  done
  if [[ -n "${BIBLIOTHEQUES// }" ]]; then
    # shellcheck disable=SC2086
    apt-get install -y -qq --no-install-recommends $BIBLIOTHEQUES >/dev/null 2>&1 || true
    ok "Bibliothèques de rendu ajoutées :${BIBLIOTHEQUES}"
  fi
fi

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
BOOTSTRAP_ADMIN_EMAIL=$BOOTSTRAP_COURRIEL
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
  if [[ "$PORT_INTERNE" != "$PORT_EXISTANT" ]]; then
    sed -i "s/^PORT=.*/PORT=$PORT_INTERNE/" "$RACINE/.env"
    avert "Port modifié dans .env : $PORT_EXISTANT → $PORT_INTERNE"
  fi

  # Une première installation en --sans-tls laisse PUBLIC_URL en http et
  # SECURE_COOKIES à false. Sans réconciliation, ces valeurs survivaient au passage
  # en TLS : le contrôle d'origine refusait alors les écritures venues de https, et
  # le cookie de session partait sans l'attribut Secure.
  if [[ $SANS_TLS -eq 0 ]]; then
    if grep -q "^PUBLIC_URL=http://$DOMAINE\$" "$RACINE/.env"; then
      sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAINE#" "$RACINE/.env"
      avert "PUBLIC_URL passé en https : le contrôle d'origine refusait sinon les écritures."
    fi
    if grep -q '^SECURE_COOKIES=false$' "$RACINE/.env"; then
      sed -i 's/^SECURE_COOKIES=.*/SECURE_COOKIES=true/' "$RACINE/.env"
      avert "SECURE_COOKIES remis à true : le cookie de session partait sans attribut Secure."
    fi
  fi
  ok ".env conservé (secrets inchangés), chemin de Chromium rafraîchi"
fi

chown root:"$UTILISATEUR" "$RACINE/.env"
chmod 0640 "$RACINE/.env"

install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0700 "$RACINE/data"
ok "Répertoire de données en 0700, réservé au service"

# ─── Service systemd ──────────────────────────────────────────────────────────
etape "Service systemd"
UNITE=/etc/systemd/system/previs.service

# L'unité en service est mise de côté : si le nouveau service ne répond pas, la
# remplacer sans retour arrière laisserait un Previs qui tournait à l'arrêt.
UNITE_AVANT=""
if [[ -f "$UNITE" ]]; then
  UNITE_AVANT="$(mktemp)"
  cp -a "$UNITE" "$UNITE_AVANT"
fi

sed -e "s#/opt/previs#$RACINE#g" -e "s#^ExecStart=.*#ExecStart=$NODE packages/server/dist/index.js#" \
  "$RACINE/deploy/previs.service" > "$UNITE"
systemctl daemon-reload
systemctl enable --quiet previs
systemctl restart previs

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT_INTERNE/api/sante" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -fsS --max-time 5 "http://127.0.0.1:$PORT_INTERNE/api/sante" >/dev/null; then
  if [[ -n "$UNITE_AVANT" ]]; then
    cp -a "$UNITE_AVANT" "$UNITE"
    rm -f "$UNITE_AVANT"
    systemctl daemon-reload
    systemctl restart previs 2>/dev/null || true
    mauvais "Le nouveau service ne répond pas. L'unité précédente a été RESTAURÉE et relancée.
  Voir ce qui a échoué : journalctl -u previs -n 50 --no-pager"
  fi
  mauvais "Le service ne répond pas. Voir : journalctl -u previs -n 50 --no-pager"
fi
rm -f "$UNITE_AVANT"
ok "Service démarré et répondant sur 127.0.0.1:$PORT_INTERNE"

if [[ $NOUVELLE_INSTALLATION -eq 1 ]]; then
  # Le compte administrateur est créé au démarrage : ses identifiants sont consignés
  # ici, et non dans le récapitulatif final. Un échec d'une étape ultérieure — nginx,
  # certificat — laisserait sinon un compte créé dont personne ne connaît le mot de passe.
  printf '%s\n' \
    "Premier accès à Previs" \
    "Adresse      : $BOOTSTRAP_COURRIEL" \
    "Mot de passe : $MOT_DE_PASSE_INITIAL" \
    "" \
    "À changer dès la première connexion, puis supprimer ce fichier :" \
    "  sudo rm $RACINE/premier-acces.txt" \
    > "$RACINE/premier-acces.txt"
  chown root:root "$RACINE/premier-acces.txt"
  chmod 0600 "$RACINE/premier-acces.txt"
  # Le compte existe désormais en base : le mot de passe d'amorçage n'a plus d'utilité
  # pour le service et n'a rien à faire dans un fichier qu'il peut lire.
  sed -i 's/^BOOTSTRAP_ADMIN_PASSWORD=.*/BOOTSTRAP_ADMIN_PASSWORD=/' "$RACINE/.env"
  ok "Identifiants du premier compte consignés dans premier-acces.txt (0600, root seul)"
fi

# ─── nginx et certificat ──────────────────────────────────────────────────────
if [[ $SANS_NGINX -eq 1 ]]; then
  etape "Serveur frontal"
  ok "Non touché, sur demande (--sans-nginx). Previs écoute sur 127.0.0.1:$PORT_INTERNE."
else
etape "nginx"


install -d -m 0755 /var/www/certbot
# L'hôte virtuel par défaut n'est PAS retiré : ce peut être un site en service.
# Le nôtre porte server_name $DOMAINE, nginx route par nom, la cohabitation va de soi.

# Première phase : un hôte virtuel en HTTP seul. Le fichier complet du dépôt
# référence des certificats qui n'existent pas encore ; nginx refuserait de démarrer.
cat > "$VHOST" <<CONFIG_VHOST
$MARQUE
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
CONFIG_VHOST
ln -sf "$VHOST" "/etc/nginx/sites-enabled/$NOM_VHOST"
nginx -t >/dev/null 2>&1 || mauvais "Configuration nginx invalide : nginx -t"

# Recharger un nginx en service, démarrer un nginx arrêté seulement si les ports
# publics sont libres. Forcer le démarrage échouerait, et surtout : un service
# volontairement à l'arrêt ne se rallume pas à l'insu de l'exploitant.
if [[ $NGINX_ACTIF -eq 1 ]]; then
  systemctl reload nginx \
    || mauvais "nginx a refusé de recharger sa configuration. Vos sites tournent toujours sur
  l'ancienne. Diagnostiquer : sudo nginx -t && sudo journalctl -xeu nginx.service"
elif port_occupe 80 || port_occupe 443; then
  mauvais "nginx.service est à l'arrêt et les ports publics sont pris par autre chose.
  L'hôte virtuel a été écrit mais n'est pas servi. Reprendre avec : $0 --sans-nginx …"
else
  systemctl enable --quiet nginx 2>/dev/null || true
  systemctl start nginx \
    || mauvais "nginx n'a pas démarré. Diagnostiquer : sudo journalctl -xeu nginx.service"
fi
ok "Hôte virtuel HTTP en place pour $DOMAINE"

if [[ $SANS_TLS -eq 0 ]]; then
  etape "Certificat Let's Encrypt"
  if [[ -f "/etc/letsencrypt/live/$DOMAINE/fullchain.pem" ]]; then
    ok "Certificat déjà présent, renouvellement automatique assuré par certbot"
  else
    # --deploy-hook : sans lui, certbot renouvelle le certificat dans deux mois mais
    # personne ne recharge nginx, qui continue de présenter l'ancien jusqu'à expiration.
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAINE" \
      --email "$COURRIEL" --agree-tos --no-eff-email --non-interactive \
      --deploy-hook 'systemctl reload nginx' \
      || mauvais "L'émission du certificat a échoué. Vérifier que le port 80 est joignable depuis Internet."
    ok "Certificat émis pour $DOMAINE, rechargement de nginx au renouvellement"
  fi

  # Un certificat déjà présent peut avoir été émis sans crochet : on le pose pour tous.
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  if [[ ! -f /etc/letsencrypt/renewal-hooks/deploy/recharger-nginx ]]; then
    printf '#!/bin/sh\n# Posé par Previs — deploy/installer.sh\nsystemctl reload nginx 2>/dev/null || true\n' \
      > /etc/letsencrypt/renewal-hooks/deploy/recharger-nginx
    chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/recharger-nginx
    ok "Crochet de rechargement posé pour les renouvellements"
  fi

  # Seconde phase : l'hôte virtuel complet du dépôt, avec TLS et les réglages
  # propres à l'export PDF et au point d'entrée MCP.
  #
  # Le fichier de phase 1 est mis de côté : s'il est déjà activé et que la nouvelle
  # version ne passe pas nginx -t, l'abandonner en place laisserait un hôte virtuel
  # invalide que le prochain rechargement — le nôtre ou celui d'un autre — refuserait.
  PHASE_UNE="$(mktemp)"
  cp -a "$VHOST" "$PHASE_UNE"
  { printf '%s\n' "$MARQUE"
    sed -e "s/previs\.tarncompta\.fr/$DOMAINE/g" \
        -e "s/127\.0\.0\.1:8080/127.0.0.1:$PORT_INTERNE/g" \
        "$RACINE/deploy/nginx.previs.conf"
  } > "$VHOST"

  if ! nginx -t >/dev/null 2>&1; then
    cp -a "$PHASE_UNE" "$VHOST"
    rm -f "$PHASE_UNE"
    mauvais "La configuration nginx en HTTPS est invalide. L'hôte virtuel a été RESTAURÉ
  dans sa version HTTP, vos sites tournent toujours.
  Voir le détail :  sudo nginx -t"
  fi
  rm -f "$PHASE_UNE"

  systemctl reload nginx \
    || mauvais "nginx a refusé de recharger sa configuration alors qu'elle est valide.
  Vos sites tournent toujours sur l'ancienne. Voir : sudo journalctl -xeu nginx.service"
  ok "HTTPS actif, redirection du port 80 en place"

  systemctl enable --quiet certbot.timer 2>/dev/null || true
fi
fi

# ─── Pare-feu ─────────────────────────────────────────────────────────────────
etape "Pare-feu"
if [[ $PARE_FEU -eq 0 ]]; then
  ok "Non touché. Ce serveur héberge d'autres services : leurs ports doivent rester ouverts."
  if [[ "$ETAT_UFW" == "inactive" || "$ETAT_UFW" == "absent" ]]; then
    avert "Aucun pare-feu actif. Pour en poser un, ouvrir d'abord TOUS les ports utiles
    aux autres sites, puis : sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable"
  fi
elif [[ "$ETAT_UFW" == "active" ]]; then
  # Le pare-feu tourne déjà : ajouter deux règles est sans effet sur le reste.
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ok "80 et 443 ouverts dans le pare-feu déjà actif — aucune autre règle modifiée"
else
  # Activer un pare-feu fermé par défaut couperait tout ce qui n'est pas 22/80/443.
  avert "ufw est $ETAT_UFW : le script ne l'active pas, cela couperait vos autres services.
    Ouvrir d'abord les ports dont ils ont besoin, puis activer ufw à la main."
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
"$NODE" -e "
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
BASE_PUBLIQUE="https://$DOMAINE"
[[ $SANS_TLS -eq 1 ]] && BASE_PUBLIQUE="http://$DOMAINE"
# Sans frontal, rien ne répond encore sur le domaine : on éprouve le service lui-même.
[[ $SANS_NGINX -eq 1 ]] && BASE_PUBLIQUE="http://127.0.0.1:$PORT_INTERNE"

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
       -d "{\"email\":\"$BOOTSTRAP_COURRIEL\",\"motDePasse\":\"$MOT_DE_PASSE_INITIAL\"}" \
       -o /dev/null; then
    # Le corps de la réponse porte le dossier entier, où chaque ligne a son propre
    # « id » : il faut l'analyser, pas y chercher un motif.
    IDENTIFIANT="$(curl -fsS --max-time 20 -b "$BISCUITS" -X POST "$BASE_PUBLIQUE/api/dossiers" \
      -H 'content-type: application/json' -H "origin: $BASE_PUBLIQUE" \
      -d '{"nom":"Essai d’installation","modele":"IS"}' \
      | "$NODE" -e 'let t="";process.stdin.on("data",c=>t+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(t).id??""))}catch{}})')"
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
  printf '\n\033[1;33m  ── Premier compte administrateur ──\033[0m\n'
  printf '  Adresse        %s\n' "$BOOTSTRAP_COURRIEL"
  printf '  Mot de passe   \033[1m%s\033[0m\n' "$MOT_DE_PASSE_INITIAL"
  printf '\n  \033[33mRetiré de .env, recopié dans %s/premier-acces.txt (root seul).\n' "$RACINE"
  printf '  Le changer à la première connexion, puis supprimer ce fichier.\033[0m\n'
fi

if [[ $SANS_NGINX -eq 1 ]]; then
  printf '\n\033[1;33m  ── Reste à faire : le renvoi depuis votre serveur frontal ──\033[0m\n'
  printf '  Previs écoute sur \033[1m127.0.0.1:%s\033[0m et n’est joignable que localement.\n' "$PORT_INTERNE"
  printf '  Renvoyer %s vers ce port, en transmettant Host et X-Forwarded-Proto.\n\n' "$DOMAINE"
  printf '  Un modèle nginx complet — export PDF, point MCP, mise en cache — est fourni :\n'
  printf '    %s/deploy/nginx.previs.conf\n\n' "$RACINE"
  printf '  Trois réglages comptent, quel que soit le frontal :\n'
  printf '   • transmettre l’en-tête Host tel que reçu ; le contrôle d’origine s’appuie dessus\n'
  printf '   • X-Forwarded-Proto https, sinon les cookies sécurisés ne seront pas posés\n'
  printf '   • laisser 180 s à /api/dossiers/…/pdf : Chromium met une dizaine de secondes au\n'
  printf '     premier appel après un redémarrage\n\n'
  printf '  Puis, si le frontal termine le TLS, ajuster PUBLIC_URL dans %s/.env\n' "$RACINE"
  printf '  et redémarrer :  sudo systemctl restart previs\n\n'
else
  printf '\n  Prochaine étape : ouvrir %s, se connecter, puis renseigner\n' "$BASE_PUBLIQUE"
  printf '  Administration → Identité du cabinet (logo, SIRET, inscription à l’Ordre).\n\n'
fi

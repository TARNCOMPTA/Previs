#!/usr/bin/env bash
#
# Branche Previs derrière un frontal Caddy en conteneur.
#
#   sudo ./deploy/brancher-frontal.sh --domaine previs.tarncompta.fr
#
# À lancer après une installation en mode --sans-nginx. Le script fait les quatre
# gestes du branchement : écoute de Previs, règle de pare-feu, bloc Caddy, contrôle.
#
# Il est conçu pour un frontal qui dessert d'autres sites en production :
#   • le Caddyfile est sauvegardé avant d'être touché ;
#   • la configuration est VALIDÉE avant tout rechargement ;
#   • une validation en échec restaure la sauvegarde et n'appelle jamais reload ;
#   • le script est idempotent — le relancer ne duplique rien.
#
set -euo pipefail

DOMAINE="${DOMAINE:-previs.tarncompta.fr}"
RACINE="${RACINE:-/opt/previs}"
CONTENEUR="${CONTENEUR:-}"
CADDYFILE_HOTE="${CADDYFILE_HOTE:-}"
SIMULATION=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domaine) DOMAINE="$2"; shift 2 ;;
    --racine) RACINE="$2"; shift 2 ;;
    --conteneur) CONTENEUR="$2"; shift 2 ;;
    --caddyfile) CADDYFILE_HOTE="$2"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

etape() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
avert() { printf '  \033[33m!\033[0m %s\n' "$*"; }
mauvais() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── Reconnaissance ───────────────────────────────────────────────────────────
etape "Reconnaissance"

[[ $EUID -eq 0 ]] || mauvais "Ce script doit être lancé avec sudo."
command -v docker >/dev/null || mauvais "docker est introuvable : ce script suppose un frontal en conteneur."
[[ -f "$RACINE/.env" ]] || mauvais "$RACINE/.env est absent. Installer d'abord : ./deploy/installer.sh --sans-nginx"

if [[ -z "$CONTENEUR" ]]; then
  # Le frontal est le conteneur qui publie le port 443.
  CONTENEUR="$(docker ps --format '{{.Names}}\t{{.Ports}}' \
    | awk -F'\t' '$2 ~ /:443->/ {print $1; exit}')"
  [[ -n "$CONTENEUR" ]] || mauvais "Aucun conteneur ne publie le port 443. En nommer un : --conteneur <nom>"
fi
docker inspect "$CONTENEUR" >/dev/null 2>&1 || mauvais "Le conteneur « $CONTENEUR » n'existe pas."
ok "Frontal : $CONTENEUR ($(docker inspect "$CONTENEUR" --format '{{.Config.Image}}'))"

case "$(docker inspect "$CONTENEUR" --format '{{.Config.Image}}')" in
  *caddy*) ;;
  *) avert "L'image ne ressemble pas à Caddy. Le bloc écrit sera du Caddyfile : vérifier avant." ;;
esac

RESEAU="$(docker inspect "$CONTENEUR" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -1)"
PASSERELLE="$(docker inspect "$CONTENEUR" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$v.Gateway}}{{"\n"}}{{end}}' | head -1)"
[[ -n "$PASSERELLE" ]] || mauvais "Impossible de lire la passerelle du réseau de $CONTENEUR."
SOUS_RESEAU="$(docker network inspect "$RESEAU" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | awk '{print $1}')"
ok "Réseau : $RESEAU — passerelle $PASSERELLE, sous-réseau ${SOUS_RESEAU:-inconnu}"

if [[ -z "$CADDYFILE_HOTE" ]]; then
  CADDYFILE_HOTE="$(docker inspect "$CONTENEUR" \
    --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
  [[ -n "$CADDYFILE_HOTE" ]] || mauvais "Le Caddyfile n'est pas monté depuis l'hôte. En donner le chemin : --caddyfile <chemin>"
fi
[[ -f "$CADDYFILE_HOTE" ]] || mauvais "$CADDYFILE_HOTE est introuvable."
ok "Caddyfile : $CADDYFILE_HOTE ($(wc -l < "$CADDYFILE_HOTE") lignes)"

PORT="$(sed -n 's/^PORT=\([0-9]\+\)$/\1/p' "$RACINE/.env" | head -1)"
[[ -n "$PORT" ]] || mauvais "Aucune ligne PORT= dans $RACINE/.env."
ok "Previs configuré sur le port $PORT"

DEJA_SERVI=0
grep -qE "^[[:space:]]*(https?://)?$DOMAINE[[:space:],{]" "$CADDYFILE_HOTE" && DEJA_SERVI=1
[[ $DEJA_SERVI -eq 1 ]] && avert "$DOMAINE figure déjà dans le Caddyfile : le bloc ne sera pas ajouté."

if [[ $SIMULATION -eq 1 ]]; then
  etape "Plan — rien n'a été modifié"
  printf '   • %s/.env : HOST=0.0.0.0 et TRUST_PROXY=loopback, uniquelocal\n' "$RACINE"
  printf '   • ufw : autoriser %s vers le port %s, refuser le reste\n' "${SOUS_RESEAU:-le sous-réseau}" "$PORT"
  [[ $DEJA_SERVI -eq 0 ]] && printf '   • %s : ajouter un bloc renvoyant %s vers %s:%s\n' \
    "$CADDYFILE_HOTE" "$DOMAINE" "$PASSERELLE" "$PORT"
  printf '   • valider la configuration, puis recharger Caddy sans interrompre les autres sites\n\n'
  exit 0
fi

# ─── 1. Previs écoute là où le conteneur peut l'atteindre ─────────────────────
etape "Écoute de Previs"
cp -a "$RACINE/.env" "$RACINE/.env.avant-branchement-$(date +%Y%m%d-%H%M%S)"

# Pour un conteneur, 127.0.0.1 est sa propre boucle locale. Écouter sur la seule
# passerelle serait plus étroit, mais le service ne démarrerait plus si le réseau
# était recréé avec un autre sous-réseau : la fermeture vient du pare-feu.
sed -i 's/^HOST=.*/HOST=0.0.0.0/' "$RACINE/.env"
# Sans cela le X-Forwarded-For du frontal est ignoré, et la limitation des tentatives
# de connexion compte tous les visiteurs sur une seule adresse.
sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=loopback, uniquelocal/' "$RACINE/.env"
grep -q '^TRUST_PROXY=' "$RACINE/.env" || echo 'TRUST_PROXY=loopback, uniquelocal' >> "$RACINE/.env"
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAINE#" "$RACINE/.env"
sed -i 's/^SECURE_COOKIES=.*/SECURE_COOKIES=true/' "$RACINE/.env"
ok "HOST=0.0.0.0, TRUST_PROXY élargi au réseau Docker, PUBLIC_URL=https://$DOMAINE"

systemctl restart previs
for _ in $(seq 1 40); do
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/sante" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/sante" >/dev/null \
  || mauvais "Previs ne répond plus après redémarrage. Voir : journalctl -u previs -n 50"
ok "Previs répond sur 127.0.0.1:$PORT"

# ─── 2. Le pare-feu laisse passer le frontal, et lui seul ─────────────────────
etape "Pare-feu"
if ! command -v ufw >/dev/null || [[ "$(ufw status | head -1)" != "Status: active" ]]; then
  avert "ufw n'est pas actif : aucune règle posée. Le port $PORT est alors ouvert sur toutes
    les interfaces — le fermer par un autre moyen."
elif [[ -z "$SOUS_RESEAU" ]]; then
  avert "Sous-réseau du frontal inconnu : aucune règle posée. À faire à la main."
else
  # Un paquet venu d'un conteneur vers l'hôte traverse la chaîne INPUT : sans règle
  # explicite, ufw en refus par défaut le rejette. C'est le piège de ce montage.
  ufw allow from "$SOUS_RESEAU" to any port "$PORT" proto tcp comment "frontal -> Previs" >/dev/null
  ufw deny "$PORT/tcp" comment "Previs jamais joignable directement" >/dev/null
  ok "$SOUS_RESEAU autorisé vers $PORT ; refusé de partout ailleurs"
fi

# ─── 3. Le bloc Caddy ─────────────────────────────────────────────────────────
etape "Caddyfile"
if [[ $DEJA_SERVI -eq 1 ]]; then
  ok "Bloc déjà présent, laissé tel quel"
else
  SAUVEGARDE="$CADDYFILE_HOTE.avant-previs-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE_HOTE" "$SAUVEGARDE"
  ok "Caddyfile sauvegardé : $SAUVEGARDE"

  cat >> "$CADDYFILE_HOTE" <<CADDY

# Previs — prévisionnel financier. Ajouté par deploy/brancher-frontal.sh.
# Caddy obtient le certificat seul, transmet Host tel que reçu et pose
# X-Forwarded-Proto : les trois réglages attendus par Previs sont acquis.
$DOMAINE {
	reverse_proxy $PASSERELLE:$PORT
}
CADDY

  # Valider AVANT de recharger : une configuration invalide ferait échouer le
  # rechargement, et les autres sites resteraient sur l'ancienne sans qu'on le sache.
  if ! docker exec "$CONTENEUR" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    cp -a "$SAUVEGARDE" "$CADDYFILE_HOTE"
    mauvais "La configuration Caddy est invalide avec ce bloc. Le Caddyfile a été RESTAURÉ,
  Caddy n'a pas été rechargé, vos sites tournent toujours.
  Voir le détail :  sudo docker exec $CONTENEUR caddy validate --config /etc/caddy/Caddyfile"
  fi
  ok "Configuration validée par Caddy"

  docker exec "$CONTENEUR" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || mauvais "Le rechargement de Caddy a échoué alors que la configuration est valide.
  Vos sites tournent toujours sur l'ancienne. Voir : sudo docker logs --tail 50 $CONTENEUR"
  ok "Caddy rechargé sans interruption"
fi

# ─── 4. Contrôle ──────────────────────────────────────────────────────────────
etape "Contrôle"
avert "Caddy demande son certificat à Let's Encrypt : compter quelques secondes."
REPONSE=""
for _ in $(seq 1 30); do
  REPONSE="$(curl -fsS --max-time 5 "https://$DOMAINE/api/sante" 2>/dev/null || true)"
  [[ "$REPONSE" == *'"service":"previs"'* ]] && break
  sleep 2
done

if [[ "$REPONSE" == *'"service":"previs"'* ]]; then
  ok "https://$DOMAINE/api/sante répond"
  curl -fsS --max-time 15 -o /dev/null "https://$DOMAINE/" && ok "L'interface se charge"
  for entete in content-security-policy x-content-type-options; do
    curl -fsSI --max-time 10 "https://$DOMAINE/" | grep -qi "^$entete" \
      || avert "En-tête $entete absent — vérifier que le frontal ne le filtre pas."
  done
  ok "En-têtes de sécurité transmis par le frontal"
else
  mauvais "https://$DOMAINE ne répond pas encore.
  Le certificat met parfois une minute. Diagnostiquer, dans cet ordre :
    sudo docker logs --tail 40 $CONTENEUR
    curl -sI http://$DOMAINE/api/sante          # le frontal route-t-il en clair ?
    sudo ufw status numbered | grep $PORT       # la règle est-elle bien là ?
    curl -s http://$PASSERELLE:$PORT/api/sante  # Previs écoute-t-il sur la passerelle ?"
fi

printf '\n\033[1;32m════ Previs est en ligne ════\033[0m\n\n'
printf '  Interface   https://%s\n' "$DOMAINE"
printf '  Point MCP   https://%s/mcp\n' "$DOMAINE"
if [[ -f "$RACINE/premier-acces.txt" ]]; then
  printf '\n\033[1;33m  ── Premier accès ──\033[0m\n'
  sed 's/^/  /' "$RACINE/premier-acces.txt"
fi
printf '\n  Prochaine étape : se connecter, changer le mot de passe, puis renseigner\n'
printf '  Administration → Identité du cabinet (logo, SIRET, inscription à l’Ordre).\n\n'

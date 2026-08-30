# ─── Étape de construction ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS construction

WORKDIR /app

# Les manifestes sont copiés seuls d'abord : la couche d'installation des
# dépendances n'est ainsi reconstruite que lorsqu'elles changent réellement.
COPY package.json package-lock.json ./
COPY packages/core/package.json     packages/core/
COPY packages/server/package.json   packages/server/
COPY packages/mcp/package.json      packages/mcp/
COPY packages/web/package.json      packages/web/

# Chromium est installé par le paquet Debian dans l'image finale : inutile que
# playwright-core en télécharge un second exemplaire ici.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ─── Image finale ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS execution

# Chromium et les bibliothèques de rendu nécessaires à la génération des PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      libpango-1.0-0 \
      libcairo2 \
      ca-certificates \
      curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=8080 \
    HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY packages/core/package.json     packages/core/
COPY packages/server/package.json   packages/server/
COPY packages/mcp/package.json      packages/mcp/
COPY packages/web/package.json      packages/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=construction /app/packages/core/dist    packages/core/dist
COPY --from=construction /app/packages/server/dist  packages/server/dist
COPY --from=construction /app/packages/mcp/dist     packages/mcp/dist
COPY --from=construction /app/packages/web/dist     packages/web/dist

# La base de données vit dans un volume : le répertoire doit appartenir à
# l'utilisateur non privilégié qui exécute le service.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/sante || exit 1

CMD ["node", "packages/server/dist/index.js"]

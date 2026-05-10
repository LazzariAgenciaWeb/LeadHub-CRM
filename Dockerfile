FROM node:20-alpine AS base
RUN apk update && apk add --no-cache libc6-compat openssl openssl-dev || \
    apk add --no-cache libc6-compat

# ─── Instalar dependências ─────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --legacy-peer-deps

# ─── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Build args opcionais — se não vierem (ex: Portainer sem --build-arg),
# auto-detectamos o commit a partir de .git/HEAD do contexto.
ARG GIT_COMMIT_SHA=
ARG BUILD_TIMESTAMP=

# Resolve commit + timestamp e grava em /app/version.json — esse arquivo é a
# fonte de verdade que o /api/version lê em runtime. Não depende do ARG ser
# propagado pra ENV (pegadinha clássica do Docker).
RUN set -e; \
    if [ -z "$GIT_COMMIT_SHA" ] || [ "$GIT_COMMIT_SHA" = "unknown" ]; then \
      if [ -f .git/HEAD ]; then \
        HEAD_REF=$(cat .git/HEAD); \
        case "$HEAD_REF" in \
          "ref: "*) \
            REF_FILE=".git/$(echo "$HEAD_REF" | sed 's/^ref: //')"; \
            if [ -f "$REF_FILE" ]; then GIT_COMMIT_SHA=$(cat "$REF_FILE"); fi ;; \
          *) GIT_COMMIT_SHA="$HEAD_REF" ;; \
        esac; \
      fi; \
    fi; \
    GIT_COMMIT_SHA="${GIT_COMMIT_SHA:-unknown}"; \
    BUILD_TIMESTAMP="${BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"; \
    echo "[build] commit=$GIT_COMMIT_SHA timestamp=$BUILD_TIMESTAMP"; \
    printf '{"commit":"%s","builtAt":"%s"}\n' "$GIT_COMMIT_SHA" "$BUILD_TIMESTAMP" > /app/version.json; \
    GIT_COMMIT_SHA="$GIT_COMMIT_SHA" BUILD_TIMESTAMP="$BUILD_TIMESTAMP" npm run build

# ─── Runner (imagem final mínima) ─────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/version.json ./version.json

# Prisma: schema + client gerado para migrations automáticas no startup
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Script de startup
COPY --chown=nextjs:nodejs start.sh ./start.sh
RUN chmod +x start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# version.json é a fonte de verdade do commit/timestamp em runtime — não
# precisamos mais propagar ARG → ENV (pegadinha do Docker que dava "unknown").

CMD ["sh", "start.sh"]

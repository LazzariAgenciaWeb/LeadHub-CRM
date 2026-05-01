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

# Build args para versionamento (injetados pelo Portainer/CI ou via --build-arg)
ARG GIT_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP
RUN BUILD_TIMESTAMP="${BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
    GIT_COMMIT_SHA="${GIT_COMMIT_SHA}" \
    npm run build
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

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

# Propaga build args para o runtime (acessíveis via process.env)
ARG GIT_COMMIT_SHA=unknown
ARG BUILD_TIMESTAMP
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

CMD ["sh", "start.sh"]

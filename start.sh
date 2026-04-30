#!/bin/sh
set -e

echo "⏳ Applying database migrations..."
node /app/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>/dev/null || \
  node /app/node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>/dev/null || \
  echo "⚠️  Could not run prisma db push — skipping (schema may already be up to date)"

# Header opcional de autorização (vazio se CRON_SECRET não estiver definido)
if [ -n "$CRON_SECRET" ]; then
  CRON_AUTH_HEADER="Authorization: Bearer ${CRON_SECRET}"
else
  CRON_AUTH_HEADER=""
fi

# Inicia sync BDR em background: aguarda 60s para o servidor subir, depois roda a cada 24h
if [ -n "$BDR_SYNC_COMPANY_ID" ]; then
  echo "🔄 BDR Sync habilitado — sincronizará a cada 24h"
  (
    sleep 60
    while true; do
      echo "[BDR Sync] $(date) — iniciando sincronização..."
      curl -s -X POST "http://localhost:3000/api/sync/bdr" \
        -H "Authorization: Bearer ${SYNC_SECRET:-leadhub-sync-secret}" \
        -H "Content-Type: application/json" \
        --max-time 120 || echo "[BDR Sync] Falha na sincronização"
      echo "[BDR Sync] Próxima sincronização em 24h"
      sleep 86400
    done
  ) &
else
  echo "ℹ️  BDR_SYNC_COMPANY_ID não definido — sync BDR desabilitado"
fi

# Cron: SLA — move conversas OPEN → PENDING após o tempo configurado por empresa
# Frequência: a cada 90 segundos (config: SLA_INTERVAL_SECONDS)
SLA_INTERVAL_SECONDS="${SLA_INTERVAL_SECONDS:-90}"
echo "⏱️  Cron SLA habilitado — rodará a cada ${SLA_INTERVAL_SECONDS}s"
(
  sleep 90
  while true; do
    curl -s -X GET "http://localhost:3000/api/cron/sla" \
      -H "$CRON_AUTH_HEADER" \
      --max-time 30 > /dev/null || echo "[Cron SLA] Falha"
    sleep "$SLA_INTERVAL_SECONDS"
  done
) &

# Cron: Sync de instâncias — busca status real na Evolution e atualiza no banco
# Frequência: a cada 5 minutos (config: SYNC_INSTANCES_INTERVAL_SECONDS)
SYNC_INSTANCES_INTERVAL_SECONDS="${SYNC_INSTANCES_INTERVAL_SECONDS:-300}"
echo "🔄 Cron Sync Instâncias habilitado — rodará a cada ${SYNC_INSTANCES_INTERVAL_SECONDS}s"
(
  sleep 120
  while true; do
    echo "[Cron Sync Instâncias] $(date) — sincronizando…"
    curl -s -X GET "http://localhost:3000/api/cron/sync-instances" \
      -H "$CRON_AUTH_HEADER" \
      --max-time 120 || echo "[Cron Sync Instâncias] Falha"
    sleep "$SYNC_INSTANCES_INTERVAL_SECONDS"
  done
) &

echo "🚀 Starting LeadHub..."
exec node server.js

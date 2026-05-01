#!/bin/sh
set -e

echo "⏳ Applying database migrations..."
node /app/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>/dev/null || \
  node /app/node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>/dev/null || \
  echo "⚠️  Could not run prisma db push — skipping (schema may already be up to date)"

# Helper de curl que adiciona Authorization SE CRON_SECRET estiver definido.
# Antes mandávamos -H "" quando o secret estava vazio — curl quebra silenciosamente
# com header vazio, fazendo as cron pararem sem aviso.
cron_curl() {
  if [ -n "$CRON_SECRET" ]; then
    curl -s -H "Authorization: Bearer ${CRON_SECRET}" "$@"
  else
    curl -s "$@"
  fi
}

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
  sleep 30
  while true; do
    RES=$(cron_curl -X GET "http://localhost:3000/api/cron/sla" --max-time 30 -w "\n%{http_code}" 2>&1)
    HTTP_CODE=$(echo "$RES" | tail -n 1)
    if [ "$HTTP_CODE" != "200" ]; then
      echo "[Cron SLA] $(date) — falha HTTP $HTTP_CODE"
    fi
    sleep "$SLA_INTERVAL_SECONDS"
  done
) &

# Cron: Sync de instâncias — busca status real na Evolution e atualiza no banco
# Frequência: a cada 5 minutos (config: SYNC_INSTANCES_INTERVAL_SECONDS)
SYNC_INSTANCES_INTERVAL_SECONDS="${SYNC_INSTANCES_INTERVAL_SECONDS:-300}"
echo "🔄 Cron Sync Instâncias habilitado — rodará a cada ${SYNC_INSTANCES_INTERVAL_SECONDS}s (1ª execução em ~45s)"
(
  sleep 45
  while true; do
    RES=$(cron_curl -X GET "http://localhost:3000/api/cron/sync-instances" --max-time 120 -w "\n%{http_code}" 2>&1)
    HTTP_CODE=$(echo "$RES" | tail -n 1)
    BODY=$(echo "$RES" | sed '$d')
    if [ "$HTTP_CODE" = "200" ]; then
      echo "[Cron Sync Instâncias] $(date) — OK · $BODY"
    else
      echo "[Cron Sync Instâncias] $(date) — falha HTTP $HTTP_CODE · $BODY"
    fi
    sleep "$SYNC_INSTANCES_INTERVAL_SECONDS"
  done
) &

# Cron: Sync de Marketing (GA4 + Search Console) — puxa dados de todas
# integrações ACTIVE com accountId definido. Roda 1x ao dia.
# Frequência: 24h (config: MARKETING_SYNC_INTERVAL_SECONDS)
MARKETING_SYNC_INTERVAL_SECONDS="${MARKETING_SYNC_INTERVAL_SECONDS:-86400}"
echo "📊 Cron Marketing Sync habilitado — rodará a cada ${MARKETING_SYNC_INTERVAL_SECONDS}s (1ª execução em ~120s)"
(
  sleep 120
  while true; do
    RES=$(cron_curl -X GET "http://localhost:3000/api/cron/marketing-sync" --max-time 600 -w "\n%{http_code}" 2>&1)
    HTTP_CODE=$(echo "$RES" | tail -n 1)
    BODY=$(echo "$RES" | sed '$d')
    if [ "$HTTP_CODE" = "200" ]; then
      echo "[Cron Marketing Sync] $(date) — OK · $BODY"
    else
      echo "[Cron Marketing Sync] $(date) — falha HTTP $HTTP_CODE · $BODY"
    fi
    sleep "$MARKETING_SYNC_INTERVAL_SECONDS"
  done
) &

echo "🚀 Starting LeadHub..."
exec node server.js

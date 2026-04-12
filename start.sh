#!/bin/sh
set -e

echo "⏳ Applying database migrations..."
node /app/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>/dev/null || \
  node /app/node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>/dev/null || \
  echo "⚠️  Could not run prisma db push — skipping (schema may already be up to date)"

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

echo "🚀 Starting LeadHub..."
exec node server.js

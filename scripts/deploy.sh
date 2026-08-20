#!/usr/bin/env bash
# Redeploy da stack leadhub-crm no Portainer (re-pull da imagem :latest do GHCR).
# Credenciais ficam em ~/.leadhub-deploy.env (PORTAINER_URL, PORTAINER_TOKEN) —
# arquivo local, fora do repo. Uso: scripts/deploy.sh
set -euo pipefail

# Credenciais: aceita PORTAINER_URL/PORTAINER_TOKEN já no ambiente (CI usa
# secrets do GitHub); senão carrega do arquivo local.
if [[ -z "${PORTAINER_URL:-}" || -z "${PORTAINER_TOKEN:-}" ]]; then
  ENV_FILE="$HOME/.leadhub-deploy.env"
  [[ -f "$ENV_FILE" ]] || { echo "erro: defina PORTAINER_URL/PORTAINER_TOKEN ou crie $ENV_FILE"; exit 1; }
  source "$ENV_FILE"
fi

STACK_ID=35
ENDPOINT_ID=2
API="curl -sk -m 60 -H X-API-Key:$PORTAINER_TOKEN"

echo "==> Buscando compose atual da stack..."
STACK_FILE=$($API "$PORTAINER_URL/api/stacks/$STACK_ID/file" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['StackFileContent'], end='')")
[[ -n "$STACK_FILE" ]] || { echo "erro: não consegui ler o stack file"; exit 1; }

echo "==> Disparando redeploy com pull da imagem..."
PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'stackFileContent': sys.stdin.read(),
    'env': [],
    'prune': False,
    'pullImage': True,
}))" <<< "$STACK_FILE")

HTTP_CODE=$($API -o /tmp/leadhub-deploy-resp.json -w '%{http_code}' \
  -X PUT "$PORTAINER_URL/api/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" \
  -H "Content-Type: application/json" -d "$PAYLOAD")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "erro: Portainer respondeu HTTP $HTTP_CODE"
  cat /tmp/leadhub-deploy-resp.json
  exit 1
fi

echo "==> Redeploy aceito. Acompanhando o serviço..."
for i in $(seq 1 30); do
  sleep 5
  STATE=$($API "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/tasks?filters=%7B%22service%22%3A%5B%22leadhub-crm_app%22%5D%7D" \
    | python3 -c "
import json, sys
tasks = json.load(sys.stdin)
tasks.sort(key=lambda t: t.get('CreatedAt',''), reverse=True)
t = tasks[0] if tasks else None
print(t['Status']['State'] if t else 'sem-tasks')")
  echo "    task mais recente: $STATE"
  if [[ "$STATE" == "running" ]]; then
    echo "==> Deploy concluído: serviço rodando."
    # Limpeza segura: só imagens dangling (sem tag e sem container usando).
    # O Docker recusa remover qualquer imagem em uso, então não afeta nada rodando.
    echo "==> Limpando imagens antigas..."
    $API -m 240 -X POST \
      "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/images/prune?filters=%7B%22dangling%22%3A%5B%22true%22%5D%7D" \
      | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'    {len(d.get(\"ImagesDeleted\") or [])} camadas removidas, {(d.get(\"SpaceReclaimed\") or 0)/1e9:.1f} GB liberados')"
    exit 0
  fi
  [[ "$STATE" == "failed" || "$STATE" == "rejected" ]] && { echo "erro: task terminou em '$STATE'"; exit 1; }
done
echo "aviso: timeout esperando o serviço estabilizar — confira no Portainer."
exit 1

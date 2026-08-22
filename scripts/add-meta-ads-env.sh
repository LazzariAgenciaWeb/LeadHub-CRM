#!/usr/bin/env bash
# Adiciona META_ADS_LOGIN_CONFIG_ID na stack leadhub-crm do Portainer.
#
# Uso único: depois que rodar com sucesso, pode apagar este arquivo.
# Lê as credenciais de ~/.leadhub-deploy.env (as mesmas do scripts/deploy.sh).
#
# É seguro rodar mais de uma vez: se a variável já existir, ele avisa e sai
# sem alterar nada. E se não achar o FACEBOOK_LOGIN_CONFIG_ID (âncora onde a
# linha nova entra), aborta sem gravar em vez de chutar um lugar.
set -euo pipefail

python3 <<'PY'
import json, urllib.request, ssl, pathlib, re

env_file = pathlib.Path.home() / ".leadhub-deploy.env"
if not env_file.exists():
    raise SystemExit(f"erro: {env_file} nao encontrado")

creds = {}
for line in env_file.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    creds[k.strip()] = v.strip().strip('"').strip("'")

try:
    url, tok = creds["PORTAINER_URL"], creds["PORTAINER_TOKEN"]
except KeyError as e:
    raise SystemExit(f"erro: {e} ausente em {env_file}")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def api(path, **kw):
    req = urllib.request.Request(
        f"{url}{path}",
        headers={"X-API-Key": tok, "Content-Type": "application/json"},
        **kw,
    )
    return urllib.request.urlopen(req, context=ctx, timeout=120)

print("==> Lendo a stack atual...")
content = json.load(api("/api/stacks/35/file"))["StackFileContent"]

if "META_ADS_LOGIN_CONFIG_ID" in content:
    print("já existe na stack — nada a fazer.")
    raise SystemExit(0)

out, done = [], False
for ln in content.splitlines(keepends=True):
    out.append(ln)
    if not done and re.match(r"^(\s+)FACEBOOK_LOGIN_CONFIG_ID\s*:", ln):
        indent = re.match(r"^(\s+)", ln).group(1)
        out.append(f'{indent}META_ADS_LOGIN_CONFIG_ID: "2073012580267520"\n')
        done = True

if not done:
    raise SystemExit("erro: FACEBOOK_LOGIN_CONFIG_ID nao encontrado — nada foi alterado.")

print("==> Gravando e redeployando (sem trocar a imagem)...")
payload = json.dumps({
    "stackFileContent": "".join(out),
    "env": [],
    "prune": False,
    "pullImage": False,
}).encode()
resp = api("/api/stacks/35?endpointId=2", data=payload, method="PUT")
print(f"HTTP {resp.status} — META_ADS_LOGIN_CONFIG_ID adicionada. Stack redeployada.")
PY

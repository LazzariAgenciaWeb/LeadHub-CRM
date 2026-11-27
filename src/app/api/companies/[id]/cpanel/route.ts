import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { encryptSecret } from "@/lib/crypto";
import {
  CpanelError, normalizeCpanelDir, normalizeCpanelHost, normalizeCpanelPort,
  normalizeCpanelToken, normalizeCpanelUsername, normalizeSiteUrl, testCpanelConnection,
} from "@/lib/cpanel";

// Integração cPanel do cliente. O token dá acesso à conta inteira da
// hospedagem, então TUDO aqui (inclusive ler a config) exige ADMIN ou
// SUPER_ADMIN — `canDelete` do cofre é exatamente esse recorte. Atendente e
// usuário CLIENT não veem nem o endereço.
async function authorize(companyId: string) {
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!auth.canDelete) return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { ok: true as const, auth };
}

const PUBLIC_SELECT = {
  host: true, port: true, username: true, publishDir: true, siteUrl: true,
  status: true, lastTestedAt: true, lastError: true, updatedAt: true, updatedByName: true,
  clientCanManageEmail: true, clientCanCreateEmail: true,
  clientCanChangeQuota: true, clientMaxQuotaMb: true, clientCanUpload: true,
  // tokenEnc NUNCA é retornado
} as const;

// GET /api/companies/[id]/cpanel → config sem o token (ou null)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;

  const cfg = await prisma.cpanelIntegration.findUnique({ where: { companyId }, select: PUBLIC_SELECT });
  return NextResponse.json({ config: cfg });
}

// PUT /api/companies/[id]/cpanel → cria/atualiza e já testa a conexão
// body: { host, port?, username, token?, publishDir?, siteUrl? }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;

  const body = await req.json().catch(() => ({}));
  const existing = await prisma.cpanelIntegration.findUnique({ where: { companyId } });

  let host: string, port: number, username: string, publishDir: string, siteUrl: string | null, token: string | null;
  try {
    host = normalizeCpanelHost(body.host);
    port = normalizeCpanelPort(body.port);
    username = normalizeCpanelUsername(body.username);
    publishDir = normalizeCpanelDir(body.publishDir || "public_html");
    siteUrl = normalizeSiteUrl(body.siteUrl);
    token = body.token && String(body.token).trim() ? normalizeCpanelToken(body.token) : null;
  } catch (e) {
    const msg = e instanceof CpanelError ? e.message : "Dados inválidos";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!existing && !token) {
    return NextResponse.json({ error: "O token é obrigatório na primeira configuração." }, { status: 400 });
  }
  // Trocar endereço, porta ou usuário mantendo o token salvo mandaria a
  // credencial antiga pra um servidor novo — quem muda o destino recadastra o token.
  if (existing && !token && (existing.host !== host || existing.port !== port || existing.username !== username)) {
    return NextResponse.json(
      { error: "Você mudou o endereço, a porta ou o usuário. Cole o token de novo pra confirmar." },
      { status: 400 },
    );
  }

  const data = {
    host, port, username, publishDir, siteUrl,
    updatedByName: a.auth.userName,
    ...(token ? { tokenEnc: encryptSecret(token) } : {}),
  };
  await prisma.cpanelIntegration.upsert({
    where: { companyId },
    create: { companyId, createdById: a.auth.userId, ...data, tokenEnc: data.tokenEnc ?? "" },
    update: data,
  });

  const test = await testCpanelConnection(companyId);
  const cfg = await prisma.cpanelIntegration.findUnique({ where: { companyId }, select: PUBLIC_SELECT });
  return NextResponse.json({ ok: true, config: cfg, test });
}

// PATCH /api/companies/[id]/cpanel → o que o cliente pode fazer no Meu Espaço.
// body: { clientCanManageEmail?, clientCanCreateEmail?, clientCanChangeQuota?, clientMaxQuotaMb?, clientCanUpload? }
// Criar caixa e mudar cota exigem o "ver e trocar senha" ligado — desligar este
// desliga os dois. Enviar arquivos é independente.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;

  const body = await req.json().catch(() => ({}));
  const existing = await prisma.cpanelIntegration.findUnique({ where: { companyId } });
  if (!existing) return NextResponse.json({ error: "cPanel não configurado para este cliente." }, { status: 404 });

  let manage = typeof body.clientCanManageEmail === "boolean" ? body.clientCanManageEmail : existing.clientCanManageEmail;
  let create = typeof body.clientCanCreateEmail === "boolean" ? body.clientCanCreateEmail : existing.clientCanCreateEmail;
  let quota = typeof body.clientCanChangeQuota === "boolean" ? body.clientCanChangeQuota : existing.clientCanChangeQuota;
  if ((create && body.clientCanCreateEmail === true) || (quota && body.clientCanChangeQuota === true)) manage = true;
  if (!manage) { create = false; quota = false; }
  const upload = typeof body.clientCanUpload === "boolean" ? body.clientCanUpload : existing.clientCanUpload;

  let maxQuota = existing.clientMaxQuotaMb;
  if ("clientMaxQuotaMb" in body) {
    const raw = body.clientMaxQuotaMb;
    if (raw === null || raw === "" || raw === 0 || raw === "0") maxQuota = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
        return NextResponse.json({ error: "Teto por caixa inválido. Informe em MB (vazio = sem teto)." }, { status: 400 });
      }
      maxQuota = n;
    }
  }

  const cfg = await prisma.cpanelIntegration.update({
    where: { companyId },
    data: {
      clientCanManageEmail: manage, clientCanCreateEmail: create,
      clientCanChangeQuota: quota, clientMaxQuotaMb: maxQuota, clientCanUpload: upload,
      updatedByName: a.auth.userName,
    },
    select: PUBLIC_SELECT,
  });
  return NextResponse.json({ ok: true, config: cfg });
}

// DELETE /api/companies/[id]/cpanel → remove a integração (apaga o token do banco)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;

  await prisma.cpanelIntegration.deleteMany({ where: { companyId } });
  return NextResponse.json({ ok: true });
}

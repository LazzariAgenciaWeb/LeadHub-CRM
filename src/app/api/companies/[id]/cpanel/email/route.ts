import { NextRequest, NextResponse } from "next/server";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { extractIp, recordAdminAction } from "@/lib/admin-audit";
import {
  CpanelError, changeCpanelMailboxPassword, createCpanelMailbox, getCpanelEmailOverview,
  normalizeMailDomain, normalizeMailboxLocal, normalizeMailboxPassword, normalizeMailboxQuota, splitMailbox,
} from "@/lib/cpanel";

// E-mails e espaço da conta do cPanel do cliente.
//
// A pasta de publicação não protege nada aqui: caixa de e-mail e cota valem pra
// conta inteira. Por isso é o mesmo recorte da config (ADMIN / SUPER_ADMIN) e
// toda criação ou troca de senha vai pro AdminAuditLog — SEM a senha.
async function authorize(companyId: string) {
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!auth.canDelete) return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { ok: true as const, auth };
}

function fail(e: unknown) {
  if (e instanceof CpanelError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("[cpanel/email]", e instanceof Error ? e.message : "erro");
  return NextResponse.json({ error: "Falha inesperada ao falar com o cPanel." }, { status: 500 });
}

// GET → { usage: { usedMb, limitMb }, mailboxes: [...], domains: [...] }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;
  try {
    return NextResponse.json(await getCpanelEmailOverview(companyId));
  } catch (e) {
    return fail(e);
  }
}

// POST → cria a caixa. body: { local, domain, password, quotaMb? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => ({}));
  try {
    const input = {
      local: normalizeMailboxLocal(body.local),
      domain: normalizeMailDomain(body.domain),
      password: normalizeMailboxPassword(body.password),
      quotaMb: normalizeMailboxQuota(body.quotaMb),
    };
    const { email } = await createCpanelMailbox(companyId, input);
    await recordAdminAction({
      adminUserId: a.auth.userId, adminUserName: a.auth.userName,
      action: "CPANEL_EMAIL_CREATE", targetCompanyId: companyId,
      ip: extractIp(req), userAgent: req.headers.get("user-agent"),
      metadata: { email, quotaMb: input.quotaMb },
    });
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return fail(e);
  }
}

// PATCH → troca a senha de uma caixa existente. body: { email, password }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const a = await authorize(companyId);
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => ({}));
  try {
    const { local, domain } = splitMailbox(body.email);
    const password = normalizeMailboxPassword(body.password);
    const { email } = await changeCpanelMailboxPassword(companyId, { local, domain, password });
    await recordAdminAction({
      adminUserId: a.auth.userId, adminUserName: a.auth.userName,
      action: "CPANEL_EMAIL_PASSWORD", targetCompanyId: companyId,
      ip: extractIp(req), userAgent: req.headers.get("user-agent"),
      metadata: { email },
    });
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return fail(e);
  }
}

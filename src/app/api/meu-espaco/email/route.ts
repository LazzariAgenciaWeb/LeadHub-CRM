import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { extractIp, recordAdminAction } from "@/lib/admin-audit";
import {
  CpanelError, changeCpanelMailboxPassword, changeCpanelMailboxQuota, createCpanelMailbox, getCpanelEmailOverview, getCpanelMailClientSettings,
  normalizeMailDomain, normalizeMailboxLocal, normalizeMailboxPassword, normalizeMailboxQuota, splitMailbox,
} from "@/lib/cpanel";

// Meu Espaço → E-mails: o cliente cuida das caixas da PRÓPRIA hospedagem.
//
// Travas:
//  - a empresa vem SEMPRE da sessão, nunca do corpo/URL — não dá pra apontar
//    pra hospedagem de outro cliente;
//  - só empresa-cliente (tem agência) e só se a agência ligou
//    `clientCanManageEmail`; criar caixa exige também `clientCanCreateEmail`;
//  - o cliente nunca vê endereço do cPanel, usuário, token nem pasta;
//  - toda troca de senha e criação vai pro AdminAuditLog (sem a senha).
async function authorize(need: "manage" | "create" | "quota") {
  const session = await getEffectiveSession();
  const u = session?.user as { id?: string; name?: string; email?: string; role?: string; companyId?: string } | undefined;
  if (!u?.id || !u.companyId) return { ok: false as const, res: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (u.role === "SUPER_ADMIN") return { ok: false as const, res: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: {
      parentCompanyId: true,
      cpanelIntegration: {
        select: {
          clientCanManageEmail: true, clientCanCreateEmail: true,
          clientCanChangeQuota: true, clientMaxQuotaMb: true, clientCanUpload: true,
        },
      },
    },
  });
  const cfg = company?.cpanelIntegration;
  const allowed = !!company?.parentCompanyId && !!cfg?.clientCanManageEmail &&
    (need === "manage" || (need === "create" && cfg.clientCanCreateEmail) || (need === "quota" && cfg.clientCanChangeQuota));
  if (!allowed) return { ok: false as const, res: NextResponse.json({ error: "Não liberado para a sua conta." }, { status: 403 }) };

  return {
    ok: true as const,
    companyId: u.companyId,
    userId: u.id,
    userName: u.name ?? u.email ?? "?",
    userEmail: u.email ?? null,
    canCreate: !!cfg?.clientCanCreateEmail,
    canChangeQuota: !!cfg?.clientCanChangeQuota,
    maxQuotaMb: cfg?.clientMaxQuotaMb ?? null,
    canUpload: !!cfg?.clientCanUpload,
  };
}

function fail(e: unknown) {
  if (e instanceof CpanelError) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("[meu-espaco/email]", e instanceof Error ? e.message : "erro");
  return NextResponse.json({ error: "Não foi possível falar com a hospedagem agora. Tente de novo em instantes." }, { status: 500 });
}

// GET → { usage, mailboxes, domains, canCreate }
// GET ?config=caixa@dominio → servidor e portas pra configurar no app de e-mail.
export async function GET(req: NextRequest) {
  const a = await authorize("manage");
  if (!a.ok) return a.res;
  try {
    const config = req.nextUrl.searchParams.get("config");
    if (config) return NextResponse.json(await getCpanelMailClientSettings(a.companyId, config));
    const data = await getCpanelEmailOverview(a.companyId);
    return NextResponse.json({
      ...data,
      canCreate: a.canCreate, canChangeQuota: a.canChangeQuota, maxQuotaMb: a.maxQuotaMb,
    });
  } catch (e) {
    return fail(e);
  }
}

// POST → cria caixa. body: { local, domain, password, quotaMb? }
export async function POST(req: NextRequest) {
  const a = await authorize("create");
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => ({}));
  try {
    const input = {
      local: normalizeMailboxLocal(body.local),
      domain: normalizeMailDomain(body.domain),
      password: normalizeMailboxPassword(body.password),
      quotaMb: normalizeMailboxQuota(body.quotaMb),
    };
    const { email, warning } = await createCpanelMailbox(a.companyId, input, { strict: true, maxQuotaMb: a.maxQuotaMb });
    await recordAdminAction({
      adminUserId: a.userId, adminUserName: a.userName, adminUserEmail: a.userEmail,
      action: "CPANEL_EMAIL_CREATE", targetCompanyId: a.companyId,
      ip: extractIp(req), userAgent: req.headers.get("user-agent"),
      metadata: { email, quotaMb: input.quotaMb, origem: "meu-espaco" },
    });
    return NextResponse.json({ ok: true, email, warning });
  } catch (e) {
    return fail(e);
  }
}

// PATCH → troca senha. body: { email, password }
//      ou muda a cota (precisa da liberação). body: { email, quotaMb }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const isQuota = body && typeof body === "object" && "quotaMb" in body;
  const a = await authorize(isQuota ? "quota" : "manage");
  if (!a.ok) return a.res;
  try {
    const { local, domain } = splitMailbox(body.email);
    if (isQuota) {
      const quotaMb = normalizeMailboxQuota(body.quotaMb);
      const r = await changeCpanelMailboxQuota(a.companyId, { local, domain, quotaMb }, { strict: true, maxQuotaMb: a.maxQuotaMb });
      await recordAdminAction({
        adminUserId: a.userId, adminUserName: a.userName, adminUserEmail: a.userEmail,
        action: "CPANEL_EMAIL_QUOTA", targetCompanyId: a.companyId,
        ip: extractIp(req), userAgent: req.headers.get("user-agent"),
        metadata: { email: r.email, quotaMb, previousQuotaMb: r.previousQuotaMb, origem: "meu-espaco" },
      });
      return NextResponse.json({ ok: true, email: r.email, warning: r.warning });
    }
    const password = normalizeMailboxPassword(body.password);
    const { email } = await changeCpanelMailboxPassword(a.companyId, { local, domain, password });
    await recordAdminAction({
      adminUserId: a.userId, adminUserName: a.userName, adminUserEmail: a.userEmail,
      action: "CPANEL_EMAIL_PASSWORD", targetCompanyId: a.companyId,
      ip: extractIp(req), userAgent: req.headers.get("user-agent"),
      metadata: { email, origem: "meu-espaco" },
    });
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return fail(e);
  }
}

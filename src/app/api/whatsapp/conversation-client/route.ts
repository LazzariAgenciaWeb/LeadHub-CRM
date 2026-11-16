import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import {
  LinkError, REASON_LABEL, knownNames, linkConversationToClient, loadAgencyContext,
  suggestClientsForConversations, unlinkConversationFromClients,
} from "@/lib/conversation-client";

// Cliente (sub-empresa) de uma conversa do WhatsApp.
//   GET    ?phone=&companyId=  → cliente atual + sugestão automática
//   POST   { phone, companyId, clientCompanyId, name?, role? } → liga (cadastra o
//          número/grupo como contato do cliente; tira de outro cliente da agência)
//   DELETE ?phone=&companyId=  → volta pra "cliente indefinido"

async function resolveAgency(req: NextRequest, bodyCompanyId?: string | null) {
  const session = await getEffectiveSession();
  if (!session) return { error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return { error: gate.response };
  const role = (session.user as any).role as string;
  if (role === "CLIENT") return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  const requested = bodyCompanyId ?? req.nextUrl.searchParams.get("companyId");
  const agencyId = role === "SUPER_ADMIN" ? requested || (session.user as any).companyId : (session.user as any).companyId;
  if (!agencyId) return { error: NextResponse.json({ error: "Empresa não informada" }, { status: 400 }) };
  return { agencyId: agencyId as string };
}

export async function GET(req: NextRequest) {
  const r = await resolveAgency(req);
  if ("error" in r) return r.error;
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { companyId_phone: { companyId: r.agencyId, phone } },
    select: { id: true, phone: true, isGroup: true },
  });
  const ctx = await loadAgencyContext(r.agencyId);
  if (!ctx || ctx.clients.length === 0) return NextResponse.json({ linked: null, suggestion: null });

  const ref = { id: conv?.id ?? `phone:${phone}`, phone };
  const names = await knownNames(r.agencyId, [ref]);
  const res = await suggestClientsForConversations(ctx, [
    { ...ref, isGroup: conv?.isGroup || phone.includes("@g.us"), name: names.get(ref.id) ?? null },
  ]);
  const out = res.get(ref.id);
  return NextResponse.json({
    linked: out?.linked ? { id: out.linked.id, name: out.linked.tradeName || out.linked.name } : null,
    suggestion: out?.suggestion
      ? {
          clientId: out.suggestion.clientId,
          clientName: out.suggestion.clientName,
          reasons: out.suggestion.reasons.map((x) => REASON_LABEL[x]),
          strong: !(out.suggestion.reasons.length === 1 && out.suggestion.reasons[0] === "NOME_PARCIAL"),
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const r = await resolveAgency(req, body.companyId);
  if ("error" in r) return r.error;
  const { phone, clientCompanyId, name, role } = body as { phone?: string; clientCompanyId?: string; name?: string; role?: string };
  if (!phone || !clientCompanyId) return NextResponse.json({ error: "phone e clientCompanyId obrigatórios" }, { status: 400 });
  const isGroup = phone.includes("@g.us");
  const normalized = isGroup ? phone.trim() : phone.trim().replace(/\D/g, "");
  try {
    const contact = await linkConversationToClient(r.agencyId, { phone: normalized, isGroup }, clientCompanyId, { name, role });
    return NextResponse.json({ ok: true, contact });
  } catch (e) {
    if (e instanceof LinkError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const r = await resolveAgency(req);
  if ("error" in r) return r.error;
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });
  const res = await unlinkConversationFromClients(r.agencyId, phone);
  return NextResponse.json({ ok: true, removed: res.count });
}

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { evolutionFetchProfilePicture, evolutionProfilePictureDebug } from "@/lib/evolution";
import { getHiddenInstanceIds, conversationVisibilityAnd } from "@/lib/whatsapp-visibility";

// POST /api/whatsapp/avatars
// Body: { phones: string[], companyId? }
// Resposta: { avatars: { [phone]: string | null } }
//
// Foto de perfil do contato / do grupo pra caixa de entrada. A URL vem do CDN
// do WhatsApp (via Evolution) e fica cacheada na Conversation — inclusive o
// "não tem foto" (url null + data preenchida), pra não reconsultar o WhatsApp
// a cada vez que a caixa abre.
//
// A URL EXPIRA: passada a TTL a gente reconsulta. Por request só buscamos umas
// poucas fotos novas (MAX_FETCH) — cada consulta é um round-trip ao WhatsApp, e
// a caixa tem centenas de conversas. As demais entram nas chamadas seguintes.

const TTL_MS    = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_FETCH = 12;
const MAX_PHONES = 80;

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin  = userRole === "SUPER_ADMIN";

  const body = await req.json().catch(() => ({}));
  const phones: string[] = Array.isArray(body?.phones)
    ? body.phones.filter((p: unknown) => typeof p === "string" && p.length > 0).slice(0, MAX_PHONES)
    : [];
  if (phones.length === 0) return NextResponse.json({ avatars: {} });

  const companyId = isSuperAdmin ? (body?.companyId ?? "") : (userCompanyId ?? "");
  // force: ignora a TTL (botão "atualizar foto" — alguém trocou a foto agora)
  const force = body?.force === true;

  const hiddenInstanceIds = await getHiddenInstanceIds(session);
  const convs = await prisma.conversation.findMany({
    where: {
      phone: { in: phones },
      ...(companyId ? { companyId } : {}),
      AND: conversationVisibilityAnd({ hiddenIds: hiddenInstanceIds }),
    },
    select: {
      id: true, phone: true, companyId: true,
      avatarUrl: true, avatarCheckedAt: true,
      instance: { select: { instanceName: true, instanceToken: true, status: true } },
    },
  });

  const avatars: Record<string, string | null> = {};
  for (const c of convs) avatars[c.phone] = c.avatarUrl ?? null;

  const now = Date.now();
  const stale = convs
    .filter((c) => force || !c.avatarCheckedAt || now - c.avatarCheckedAt.getTime() > TTL_MS)
    .slice(0, MAX_FETCH);

  if (stale.length === 0) return NextResponse.json({ avatars });

  // Instância pra consultar: a da própria conversa quando conectada; senão
  // qualquer conectada da empresa (a foto é a mesma — quem pergunta ao
  // WhatsApp é um número nosso, não importa qual).
  const fallbackByCompany = new Map<string, { instanceName: string; instanceToken: string | null } | null>();
  async function pickInstance(c: (typeof stale)[number]) {
    if (c.instance?.status === "CONNECTED") {
      return { instanceName: c.instance.instanceName, instanceToken: c.instance.instanceToken };
    }
    if (!fallbackByCompany.has(c.companyId)) {
      const inst = await prisma.whatsappInstance.findFirst({
        where: { companyId: c.companyId, status: "CONNECTED" },
        select: { instanceName: true, instanceToken: true },
      });
      fallbackByCompany.set(c.companyId, inst ?? null);
    }
    return fallbackByCompany.get(c.companyId) ?? null;
  }

  for (const c of stale) {
    const inst = await pickInstance(c);
    if (!inst) continue; // sem instância conectada → tenta de novo depois

    const target = c.phone.includes("@") ? c.phone : c.phone.replace(/\D/g, "");
    const url = await evolutionFetchProfilePicture(inst.instanceName, target, inst.instanceToken);

    avatars[c.phone] = url;
    console.log(`[WA avatar] ${c.phone} → ${url ? "foto" : "sem foto"} (instância ${inst.instanceName})`);
    await prisma.conversation.update({
      where: { id: c.id },
      data: { avatarUrl: url, avatarCheckedAt: new Date() },
    }).catch(() => {});
  }

  return NextResponse.json({ avatars });
}


// GET /api/whatsapp/avatars  → diagnóstico (ADMIN / SUPER_ADMIN)
// Responde por que a foto não apareceu: se a coluna existe no banco, se há
// instância conectada e o que exatamente a Evolution devolveu para um contato
// e para um grupo. Sem isso, "não apareceu" vira adivinhação.
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const isSuperAdmin = role === "SUPER_ADMIN";
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const { searchParams } = new URL(req.url);
  const companyId = isSuperAdmin ? (searchParams.get("companyId") ?? userCompanyId ?? "") : (userCompanyId ?? "");

  const out: Record<string, unknown> = { companyId: companyId || "(global)" };

  // 1) A coluna existe? (db push pode ter falhado no startup)
  try {
    const comFoto = await prisma.conversation.count({ where: { avatarUrl: { not: null } } });
    const jaConsultadas = await prisma.conversation.count({ where: { avatarCheckedAt: { not: null } } });
    out.colunaOk = true;
    out.conversasComFoto = comFoto;
    out.conversasJaConsultadas = jaConsultadas;
  } catch (err: any) {
    out.colunaOk = false;
    out.erroColuna = String(err?.message ?? err).slice(0, 300);
    return NextResponse.json(out);
  }

  // 2) Tem instância conectada pra perguntar?
  const inst = await prisma.whatsappInstance.findFirst({
    where: { ...(companyId ? { companyId } : {}), status: "CONNECTED" },
    select: { instanceName: true, instanceToken: true },
  });
  out.instancia = inst?.instanceName ?? null;
  if (!inst) return NextResponse.json({ ...out, conclusao: "Nenhuma instância CONNECTED — nada a consultar." });

  // 3) O que a Evolution responde, de verdade, pra um contato e pra um grupo
  const alvoParam = searchParams.get("phone");
  const contato = alvoParam && !alvoParam.includes("@g.us")
    ? { phone: alvoParam }
    : await prisma.conversation.findFirst({
        where: { ...(companyId ? { companyId } : {}), isGroup: false, phone: { not: { contains: "@" } } },
        orderBy: { lastMessageAt: "desc" },
        select: { phone: true },
      });
  const grupo = alvoParam && alvoParam.includes("@g.us")
    ? { phone: alvoParam }
    : await prisma.conversation.findFirst({
        where: { ...(companyId ? { companyId } : {}), phone: { contains: "@g.us" } },
        orderBy: { lastMessageAt: "desc" },
        select: { phone: true },
      });

  if (contato) {
    out.contato = {
      phone: contato.phone,
      ...(await evolutionProfilePictureDebug(inst.instanceName, contato.phone.replace(/\D/g, ""), inst.instanceToken)),
    };
  }
  if (grupo) {
    out.grupo = {
      phone: grupo.phone,
      ...(await evolutionProfilePictureDebug(inst.instanceName, grupo.phone, inst.instanceToken)),
    };
  }

  return NextResponse.json(out);
}

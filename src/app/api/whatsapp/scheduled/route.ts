import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// Mensagens agendadas MANUAIS (atendente escolhe data/hora).
// Reaproveita a fila ScheduledMessage processada pelo cron
// /api/cron/scheduled-messages (loop do start.sh, ~2 min). kind="manual"
// distingue dos lembretes automáticos do agente de IA.
//
// GET  ?phone=&companyId=  → agendadas pendentes/falhas daquela conversa
// POST { instanceId, phone, text, sendAt(ISO) } → agenda

const MIN_AHEAD_MS = 60_000;                // pelo menos 1 min no futuro
const MAX_AHEAD_MS = 365 * 24 * 3600_000;   // no máximo 1 ano

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const sp = new URL(req.url).searchParams;
  const phone = sp.get("phone");
  if (!phone) return NextResponse.json({ error: "phone é obrigatório" }, { status: 400 });
  const companyId = role === "SUPER_ADMIN" ? (sp.get("companyId") || userCompanyId) : userCompanyId;
  if (!companyId) return NextResponse.json({ scheduled: [] });

  const rows = await prisma.scheduledMessage.findMany({
    where: { companyId, phone, kind: "manual", status: { in: ["PENDING", "SENDING", "FAILED"] } },
    orderBy: { sendAt: "asc" },
    take: 50,
    // mediaBase64 fora do select de listagem (blob) — só o tipo, pra UI marcar 🖼️
    select: {
      id: true, body: true, sendAt: true, status: true, lastError: true, meta: true, mediaType: true,
      instance: { select: { id: true, instanceName: true, label: true } },
    },
  });

  return NextResponse.json({
    scheduled: rows.map((r) => ({
      id: r.id,
      body: r.body,
      hasImage: !!r.mediaType,
      sendAt: r.sendAt.toISOString(),
      status: r.status,
      lastError: r.lastError,
      createdByName: (r.meta as any)?.userName ?? null,
      instance: r.instance,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const userId = (session.user as any).id as string | undefined;
  const userName = (session.user as any).name as string | undefined;

  const body = await req.json().catch(() => ({}));
  const instanceId = String(body.instanceId ?? "");
  const phone = String(body.phone ?? "").trim();
  const sendAt = new Date(String(body.sendAt ?? ""));

  // SEQUÊNCIA: `items` = [{ text?, media?, mediaMimeType? }] (até 5) saem em
  // ordem no mesmo horário. Compat: sem `items`, usa text/media do topo como
  // item único.
  const rawItems: any[] = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [{ text: body.text, media: body.media, mediaMimeType: body.mediaMimeType }];
  if (rawItems.length > 5) {
    return NextResponse.json({ error: "Sequência limitada a 5 mensagens" }, { status: 400 });
  }

  type Item = { text: string; media: string | null; mediaType: string | null };
  const items: Item[] = [];
  for (const it of rawItems) {
    const text = String(it?.text ?? "").trim();
    // Imagem opcional (base64 do anexo, já comprimido no cliente); text vira legenda
    const media = typeof it?.media === "string" && it.media.length > 0
      ? it.media.replace(/^data:[^;]+;base64,/, "")
      : null;
    const mediaType = media && typeof it?.mediaMimeType === "string" && it.mediaMimeType.startsWith("image/")
      ? it.mediaMimeType
      : null;
    if (media && !mediaType) {
      return NextResponse.json({ error: "Só é possível agendar imagem (jpg/png/webp)" }, { status: 400 });
    }
    if (media && media.length > 12_000_000) {
      return NextResponse.json({ error: "Imagem grande demais para agendar" }, { status: 400 });
    }
    if (!text && !media) continue; // item vazio é ignorado
    items.push({ text, media, mediaType });
  }

  if (!instanceId || !phone || items.length === 0) {
    return NextResponse.json({ error: "Escreva um texto ou anexe uma imagem pra agendar" }, { status: 400 });
  }
  if (Number.isNaN(sendAt.getTime())) {
    return NextResponse.json({ error: "Data/hora inválida" }, { status: 400 });
  }
  const ahead = sendAt.getTime() - Date.now();
  if (ahead < MIN_AHEAD_MS) {
    return NextResponse.json({ error: "Escolha um horário pelo menos 1 minuto no futuro" }, { status: 400 });
  }
  if (ahead > MAX_AHEAD_MS) {
    return NextResponse.json({ error: "Agendamento limitado a 1 ano" }, { status: 400 });
  }

  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, companyId: true, company: { select: { modoAtendimento: true } } },
  });
  if (!instance) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && instance.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  // Mesma regra do envio: empresa em modo Visão não envia pelo painel.
  if (role !== "SUPER_ADMIN" && instance.company?.modoAtendimento === "VISAO") {
    return NextResponse.json({ error: "Empresa em modo Visão (somente leitura)." }, { status: 403 });
  }

  // Intervalo entre os itens da sequência (segundos, 2–600; padrão 5). O cron
  // processa por sendAt asc e aguarda o horário exato de cada item, então a
  // sequência sai na ordem montada, espaçada pelo intervalo escolhido.
  const intervalSec = Math.min(600, Math.max(2, Number(body.intervalSeconds) || 5));
  const intervalMs = intervalSec * 1000;
  const groupId = items.length > 1 ? `seq-${Date.now()}` : null;
  const created = await prisma.$transaction(
    items.map((it, idx) =>
      prisma.scheduledMessage.create({
        data: {
          companyId: instance.companyId,
          instanceId: instance.id,
          phone,
          body: it.text,
          sendAt: new Date(sendAt.getTime() + idx * intervalMs),
          ...(it.media ? { mediaBase64: it.media, mediaType: it.mediaType } : {}),
          kind: "manual",
          meta: {
            userId: userId ?? null,
            userName: userName ?? null,
            ...(groupId ? { groupId, seq: idx + 1, seqTotal: items.length } : {}),
          } as any,
        },
        select: { id: true },
      }),
    ),
  );

  return NextResponse.json({ ok: true, ids: created.map((c) => c.id), count: created.length, sendAt: sendAt.toISOString() });
}

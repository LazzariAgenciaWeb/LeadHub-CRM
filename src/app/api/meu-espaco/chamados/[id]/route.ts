import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// Detalhe + resposta de um chamado/pedido PELO CLIENTE logado.
// Escopo: o ticket precisa ser da empresa do cliente (clientCompanyId === companyId)
// e não pode ser interno. Mensagens internas nunca são expostas ao cliente.

async function loadOwned(id: string, companyId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true, title: true, category: true, status: true, description: true, createdAt: true, clientCompanyId: true, isInternal: true },
  });
  if (!ticket || ticket.isInternal || ticket.clientCompanyId !== companyId) return null;
  return ticket;
}

type Att = { id: string; fileName: string; mimeType: string };

// Prints/anexos da mensagem pro cliente ver: a imagem embutida antiga
// (mediaBase64, servida por /api/tickets/messages/[id]/media) + os arquivos
// do storage (StorageObject → /api/storage/[id]). As duas rotas liberam o
// cliente do chamado só pra mensagem não interna.
const shape = (
  m: { id: string; body: string; authorName: string; source: string; createdAt: Date; mediaType?: string | null; attachments?: Att[] },
  hasMedia = false,
) => ({
  id: m.id, body: m.body, authorName: m.authorName,
  mine: m.source === "CLIENT_PORTAL", createdAt: m.createdAt,
  media: hasMedia ? { url: `/api/tickets/messages/${m.id}/media`, mimeType: m.mediaType ?? "image/jpeg" } : null,
  files: (m.attachments ?? []).map((a) => ({ ...a, url: `/api/storage/${a.id}` })),
});

// GET — thread do chamado (status + mensagens visíveis ao cliente)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const ticket = await loadOwned(id, companyId);
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  const [messages, withMedia, ticketFiles] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: { ticketId: id, isInternal: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, body: true, authorName: true, source: true, createdAt: true, mediaType: true,
        attachments: { where: { status: "READY" }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, mimeType: true } },
      },
    }),
    // Quais têm imagem embutida — SEM carregar o base64 (carregar em lote já
    // derrubou o Postgres por memória; a imagem vem pela rota de mídia).
    prisma.ticketMessage.findMany({
      where: { ticketId: id, isInternal: false, mediaBase64: { not: null } },
      select: { id: true },
    }),
    // Arquivos do chamado em si (sem mensagem), ex.: os enviados na abertura.
    prisma.storageObject.findMany({
      where: { ticketId: id, ticketMessageId: null, status: "READY" },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true, mimeType: true },
    }),
  ]);
  const mediaIds = new Set(withMedia.map((m) => m.id));

  return NextResponse.json({
    id: ticket.id, title: ticket.title, category: ticket.category,
    status: ticket.status, createdAt: ticket.createdAt,
    files: ticketFiles.map((a) => ({ ...a, url: `/api/storage/${a.id}` })),
    messages: messages.map((m) => shape(m, mediaIds.has(m.id))),
  });
}

// POST — cliente responde no chamado. Reabre se estava resolvido/fechado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const userName = (session?.user as any)?.name as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const ticket = await loadOwned(id, companyId);
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Escreva sua mensagem." }, { status: 400 });

  const msg = await prisma.ticketMessage.create({
    data: {
      ticketId:   id,
      body:       text,
      authorName: userName ?? "Cliente",
      authorRole: role ?? "CLIENT",
      isInternal: false,
      source:     "CLIENT_PORTAL",
    },
    select: { id: true, body: true, authorName: true, source: true, createdAt: true },
  });

  // Resposta do cliente reabre o chamado se ele estava encerrado.
  const reopened = ticket.status === "RESOLVED" || ticket.status === "CLOSED";
  await prisma.ticket.update({
    where: { id },
    data: reopened ? { status: "OPEN", updatedAt: new Date() } : { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, message: shape(msg), status: reopened ? "OPEN" : ticket.status }, { status: 201 });
}

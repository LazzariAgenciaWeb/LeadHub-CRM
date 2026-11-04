import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadCompanyHours, clampDueDateToBusinessHours } from "@/lib/business-hours";
import { sendPushToUser } from "@/lib/push";

// POST /api/acesso-portal
// Body: { token, kind: "chamado" | "aprovacao", name, email, phone? }
//
// Cliente pedindo login no portal (/meu-espaco) pelos links públicos que ele já
// tem: o chamado (/acompanhar/[token]) ou a peça (/aprovar/[token]). Sem login,
// então o token é a credencial — ele diz de qual agência e de qual
// empresa-cliente o pedido é. Vira CHAMADO na agência (pra não se perder) e
// aviso no WhatsApp de quem administra.

export const CATEGORIA = "Acesso ao portal";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const JANELA_MS = 24 * 3_600_000;
const MAX_POR_CLIENTE = 5; // teto por empresa-cliente na janela, contra enxurrada

type Origem = {
  agencyCompanyId: string;
  clientCompanyId: string | null;
  assigneeId:      string | null;
  descricao:       string;
};

async function resolveOrigem(kind: string, token: string): Promise<Origem | null> {
  if (!token || token.length < 8) return null;

  if (kind === "chamado") {
    const t = await prisma.ticket.findUnique({
      where:  { publicToken: token },
      select: { id: true, title: true, companyId: true, clientCompanyId: true, isInternal: true, assigneeId: true, createdById: true },
    });
    if (!t || t.isInternal) return null;
    return {
      agencyCompanyId: t.companyId,
      clientCompanyId: t.clientCompanyId,
      assigneeId:      t.assigneeId ?? t.createdById ?? null,
      descricao:       `chamado "${t.title}"`,
    };
  }

  if (kind === "aprovacao") {
    const task = await prisma.projectTask.findUnique({
      where:  { approvalToken: token },
      select: {
        title: true, assigneeId: true,
        project: { select: { name: true, clientCompanyId: true, setor: { select: { companyId: true } } } },
      },
    });
    if (!task) return null;
    return {
      agencyCompanyId: task.project.setor.companyId,
      clientCompanyId: task.project.clientCompanyId,
      assigneeId:      task.assigneeId ?? null,
      descricao:       `aprovação de "${task.title}" (${task.project.name})`,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind  = String(body?.kind ?? "");
  const token = String(body?.token ?? "");
  const name  = String(body?.name ?? "").trim().slice(0, 80);
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 160);
  const phone = String(body?.phone ?? "").trim().slice(0, 40);

  const origem = await resolveOrigem(kind, token);
  if (!origem) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  if (name.length < 2)      return NextResponse.json({ error: "Informe seu nome." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });

  const desde = new Date(Date.now() - JANELA_MS);
  const where = { companyId: origem.agencyCompanyId, category: CATEGORIA, createdAt: { gte: desde } };

  // Já existe um pedido com este e-mail na janela: responde ok sem abrir
  // chamado novo (o cliente clicou duas vezes, ou pediu ontem).
  const repetido = await prisma.ticket.findFirst({
    where:  { ...where, description: { contains: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (repetido) return NextResponse.json({ ok: true, repetido: true });

  if (origem.clientCompanyId) {
    const n = await prisma.ticket.count({ where: { ...where, clientCompanyId: origem.clientCompanyId } });
    if (n >= MAX_POR_CLIENTE) {
      return NextResponse.json(
        { error: "Já recebemos vários pedidos de acesso da sua empresa hoje. Fale com a gente pelo grupo do WhatsApp." },
        { status: 429 },
      );
    }
  }

  // Login já existe com este e-mail: nada de senha nem de conta por aqui — o
  // chamado sai avisando a equipe, que confirma ou manda redefinir a senha.
  const jaTemLogin = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  const cliente = origem.clientCompanyId
    ? await prisma.company.findUnique({ where: { id: origem.clientCompanyId }, select: { name: true } })
    : null;

  const descricao = [
    `${name} pediu acesso ao portal do cliente pelo link de ${origem.descricao}.`,
    "",
    `E-mail pro login: ${email}`,
    phone ? `Telefone: ${phone}` : null,
    cliente ? `Empresa-cliente: ${cliente.name}` : null,
    jaTemLogin ? "Obs.: já existe usuário com este e-mail — confira se é a mesma pessoa e mande redefinir a senha." : null,
  ].filter(Boolean).join("\n");

  const hours = await loadCompanyHours(origem.agencyCompanyId);
  const dueDate = clampDueDateToBusinessHours(new Date(Date.now() + JANELA_MS), hours);

  const ticket = await prisma.ticket.create({
    data: {
      title:           `Acesso ao portal: ${name}`,
      description:     descricao,
      category:        CATEGORIA,
      priority:        "MEDIUM",
      type:            "SUPPORT",
      companyId:       origem.agencyCompanyId,
      clientCompanyId: origem.clientCompanyId,
      assigneeId:      origem.assigneeId,
      dueDate,
      messages: {
        create: { body: descricao, authorName: name, authorRole: "CLIENT", isInternal: false, source: "CLIENT_PORTAL" },
      },
    },
    select: { id: true },
  });

  // ClickUp (best-effort): o chamado nasce na lista padrão da agência, como
  // qualquer outro — é demanda da equipe, não vai pra lista do cliente.
  try {
    const { getClickupSettings, syncTicketToClickup } = await import("@/lib/clickup");
    const settings = await getClickupSettings(origem.agencyCompanyId);
    if (settings) {
      const clickupTaskId = await syncTicketToClickup({
        settings, ticketId: ticket.id, title: `Acesso ao portal: ${name}`,
        description: descricao, priority: "MEDIUM", status: "OPEN",
      });
      if (clickupTaskId) await prisma.ticket.update({ where: { id: ticket.id }, data: { clickupTaskId } });
    }
  } catch (e) {
    console.error("[acesso-portal] clickup:", e);
  }

  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
  const link = `${base}/chamados/${ticket.id}`;

  if (origem.assigneeId) {
    void sendPushToUser(
      origem.assigneeId,
      {
        title: "🔑 Pedido de acesso ao portal",
        body:  `${name} (${email})${cliente ? ` · ${cliente.name}` : ""}`,
        url:   `/chamados/${ticket.id}`,
        tag:   `acesso-${ticket.id}`,
      },
      "newMessage",
    ).catch(() => {});
  }

  // WhatsApp de quem administra a agência: quem pediu está esperando, então
  // vai na hora (não no resumo). Sem grupo pareado, o chamado já cobre.
  void (async () => {
    try {
      const { sendAssistantMessage } = await import("@/lib/personal-assistant/whatsapp");
      const admins = await prisma.user.findMany({
        where:  { companyId: origem.agencyCompanyId, role: "ADMIN", assistantGroupJid: { not: null } },
        select: { id: true },
      });
      const texto = [
        "🔑 *Pedido de acesso ao portal*",
        "",
        `${name}${cliente ? ` · ${cliente.name}` : ""}`,
        `E-mail pro login: ${email}`,
        phone ? `Telefone: ${phone}` : null,
        `Veio do link de ${origem.descricao}.`,
        jaTemLogin ? "Já existe usuário com este e-mail." : null,
        "",
        link,
      ].filter(Boolean).join("\n");
      for (const a of admins) await sendAssistantMessage(a.id, texto);
    } catch (e) {
      console.error("[acesso-portal] aviso no WhatsApp:", e);
    }
  })();

  return NextResponse.json({ ok: true }, { status: 201 });
}

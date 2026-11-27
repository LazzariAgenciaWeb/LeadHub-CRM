import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { splitMailbox } from "@/lib/cpanel";

// POST /api/meu-espaco/email/chamado — chamado de e-mail aberto pelo cliente.
//
// Cai no fluxo normal de Chamados da agência (igual /api/meu-espaco/chamados),
// mas já leva os dados técnicos que o atendimento sempre precisa pedir: a caixa,
// o IP de onde o cliente abriu (bloqueio de IP no servidor é o caso mais comum)
// e o navegador. O IP é lido aqui no servidor — o cliente não digita nada.
//
// Body: { topic, mailbox?, description }
const TOPICS: Record<string, string> = {
  "nao-recebe": "Não estou recebendo e-mails",
  "nao-envia": "Não consigo enviar e-mails",
  "nao-conecta": "O e-mail não conecta / pede a senha",
  "excluir": "Excluir uma conta de e-mail",
  "outro": "Outro problema no e-mail",
};

/** IP público de quem abriu: Cloudflare primeiro, depois o proxy da frente. */
function clientIp(req: NextRequest): string | null {
  const h = req.headers;
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  const u = session?.user as { id?: string; name?: string; role?: string; companyId?: string } | undefined;
  if (!u?.id || !u.companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (u.role === "SUPER_ADMIN") return NextResponse.json({ error: "Ação disponível apenas para clientes." }, { status: 403 });

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: { name: true, parentCompanyId: true, cpanelIntegration: { select: { clientCanManageEmail: true } } },
  });
  if (!company?.parentCompanyId || !company.cpanelIntegration?.clientCanManageEmail) {
    return NextResponse.json({ error: "Não liberado para a sua conta." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const topic = TOPICS[String(body?.topic ?? "")] ? String(body.topic) : "outro";
  const description = String(body?.description ?? "").trim().slice(0, 5000);
  let mailbox: string | null = null;
  if (body?.mailbox) {
    try {
      const { local, domain } = splitMailbox(body.mailbox);
      mailbox = `${local}@${domain}`;
    } catch {
      return NextResponse.json({ error: "Caixa de e-mail inválida." }, { status: 400 });
    }
  }
  if (topic === "excluir" && !mailbox) return NextResponse.json({ error: "Escolha a conta que quer excluir." }, { status: 400 });
  if (!description && topic === "outro") return NextResponse.json({ error: "Conte o que está acontecendo." }, { status: 400 });

  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const title = `E-mail: ${TOPICS[topic]}${mailbox ? ` — ${mailbox}` : ""}`;
  const finalDesc = [
    description || TOPICS[topic],
    "",
    "— Dados enviados automaticamente —",
    `Assunto: ${TOPICS[topic]}`,
    `Caixa: ${mailbox ?? "não informada"}`,
    `IP de onde o chamado foi aberto: ${ip ?? "não identificado"}`,
    `Navegador: ${ua || "não identificado"}`,
    `Aberto em: ${when}`,
  ].join("\n");

  const ticket = await prisma.ticket.create({
    data: {
      title,
      description: finalDesc,
      priority: topic === "excluir" ? "MEDIUM" : "HIGH", // e-mail parado trava o cliente
      category: "Suporte",
      type: "SUPPORT",
      companyId: company.parentCompanyId,
      clientCompanyId: u.companyId,
      createdById: u.id,
      dueDate: new Date(Date.now() + (topic === "excluir" ? 3 : 1) * 24 * 60 * 60 * 1000),
      visibility: "OPEN",
      messages: {
        create: {
          body: finalDesc,
          authorName: u.name ?? company.name,
          authorRole: u.role ?? "CLIENT",
          isInternal: false,
          source: "CLIENT_PORTAL",
        },
      },
    },
    select: { id: true, title: true },
  });

  return NextResponse.json({ ok: true, ticket }, { status: 201 });
}

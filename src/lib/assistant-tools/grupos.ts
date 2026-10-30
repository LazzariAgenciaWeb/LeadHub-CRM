import { prisma } from "@/lib/prisma";
import { type ToolDef, ok, fail, appUrl, fmtDateTime } from "./types";

/**
 * Ferramentas de GRUPOS DE WHATSAPP — triagem e contexto.
 *
 * Responde três perguntas que antes só se respondia abrindo a Inbox na mão:
 *   1. que grupo de cliente pediu algo e ficou sem resposta nossa?
 *   2. nessa conversa, quem falou: o cliente, um atendente nosso, ou o agente de IA?
 *   3. o que foi pedido no grupo já virou chamado/projeto — está sendo resolvido?
 *
 * O vínculo grupo → cliente vive em CompanyContact (phone = JID @g.us,
 * isGroup=true) cujo companyId é a EMPRESA-CLIENTE (filha da agência) quando o
 * grupo foi atribuído, ou a própria agência quando ainda não foi. Por isso toda
 * busca de contato aceita os dois escopos.
 */

/** Status de conversa que NÃO conta como "esperando nossa resposta". */
const STATUS_RESOLVIDO = ["CLOSED", "SCHEDULED", "WAITING_CUSTOMER"] as const;

type GroupContact = {
  phone: string;
  name: string | null;
  clientId: string | null;
  clientName: string | null;
};

/** Resolve nome do grupo + empresa-cliente vinculada para uma lista de JIDs. */
async function loadGroupContacts(companyId: string, jids: string[]): Promise<Map<string, GroupContact>> {
  if (jids.length === 0) return new Map();
  const rows = await prisma.companyContact.findMany({
    where: {
      phone: { in: jids },
      isGroup: true,
      OR: [{ companyId }, { company: { parentCompanyId: companyId } }],
    },
    select: {
      phone: true,
      name: true,
      company: { select: { id: true, name: true, parentCompanyId: true } },
    },
  });
  const map = new Map<string, GroupContact>();
  for (const r of rows) {
    const isClient = r.company.parentCompanyId === companyId;
    const prev = map.get(r.phone);
    // Contato sob a empresa-cliente ganha do contato sob a agência: é o vínculo real.
    if (prev && !isClient) continue;
    map.set(r.phone, {
      phone: r.phone,
      name: r.name,
      clientId: isClient ? r.company.id : null,
      clientName: isClient ? r.company.name : null,
    });
  }
  return map;
}

function horasDesde(d: Date | null | undefined, now: Date): number | null {
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / 3_600_000);
}

function tempoHumano(horas: number | null): string {
  if (horas === null) return "sem mensagem";
  if (horas < 1) return "menos de 1h";
  if (horas < 48) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

/** Como chamar a instância nossa que enviou: nome amigável + número. */
function nomeInstancia(i: { instanceName: string; label: string | null; phone: string | null } | null): string {
  if (!i) return "instância não registrada";
  const nome = i.label ?? i.instanceName;
  return i.phone ? `${nome} / ${i.phone}` : nome;
}

function trecho(s: string | null | undefined, n = 110): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(sem texto — mídia ou anexo)";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Só o número do JID: "5544999…@s.whatsapp.net" / "…:12@lid" → "5544999…". */
function soNumero(jid: string): string {
  return jid.replace(/@.*$/, "").replace(/:.*$/, "");
}

export type Reacao = { emoji: string; autor: string; ehEquipe: boolean; em: string | null };

/**
 * Lê o mapa `Message.reactions` que o webhook grava (reatorKey → { emoji, name,
 * fromMe, at }) e devolve no formato do MCP. Reação removida já sai do mapa no
 * webhook; entrada sem emoji é descartada aqui por garantia.
 *
 * `fonesEquipe` é quem conta como NOSSO: os números das nossas instâncias mais
 * os identificadores de quem já falou pelo nosso lado neste grupo (ver
 * `lidsDaEquipe`). Sem isso, reação nossa feita do aparelho — que não vem com
 * fromMe — passaria por reação do cliente.
 */
function lerReacoes(raw: unknown, fonesEquipe: Set<string>): Reacao[] {
  if (!raw || typeof raw !== "object") return [];
  const out: Reacao[] = [];
  type Bruta = { emoji?: unknown; name?: unknown; fromMe?: unknown; at?: unknown };
  for (const [chave, v] of Object.entries(raw as Record<string, Bruta>)) {
    const emoji = typeof v?.emoji === "string" ? v.emoji.trim() : "";
    if (!emoji) continue;
    const ehNossaInstancia = chave.startsWith("me:");
    const numero   = ehNossaInstancia ? null : soNumero(chave);
    const ehEquipe = v?.fromMe === true || ehNossaInstancia || (!!numero && fonesEquipe.has(numero));
    out.push({
      emoji,
      autor:    (typeof v?.name === "string" && v.name) || numero || "nós",
      ehEquipe,
      em:       typeof v?.at === "string" ? v.at : null,
    });
  }
  return out;
}

/**
 * Quem já falou pelo NOSSO lado neste grupo. Em grupo o WhatsApp identifica o
 * participante por @lid, que não bate com o telefone da instância — então o
 * número sozinho não reconhece o atendente que reagiu do próprio aparelho.
 * Quem aparece como autor de mensagem OUTBOUND aqui é nosso, por definição.
 */
function lidsDaEquipe(msgs: Array<{ direction: string; participantPhone: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const m of msgs) {
    if (m.direction === "OUTBOUND" && m.participantPhone) out.add(soNumero(m.participantPhone));
  }
  return out;
}

/** Números das nossas instâncias, pra reconhecer reação da equipe. */
async function loadFonesEquipe(companyId: string): Promise<Set<string>> {
  const rows = await prisma.whatsappInstance.findMany({
    where:  { companyId },
    select: { phone: true },
  });
  return new Set(rows.map((r) => r.phone).filter((p): p is string => !!p).map(soNumero));
}

/** Sufixo pra linha de mensagem: " {👍 NÓS, ❤️ Raíssa}". Vazio quando não há. */
function reacoesTexto(rs: Reacao[]): string {
  if (rs.length === 0) return "";
  return ` {${rs.map((r) => `${r.emoji} ${r.ehEquipe ? "NÓS" : r.autor}`).join(", ")}}`;
}

/** Chamados abertos e projetos ativos por empresa-cliente (lote). */
async function loadClientWork(companyId: string, clientIds: string[]) {
  const ids = Array.from(new Set(clientIds.filter(Boolean)));
  if (ids.length === 0) return { tickets: new Map<string, number>(), projects: new Map<string, number>() };
  const [tickets, projects] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["clientCompanyId"],
      where: { companyId, clientCompanyId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      _count: { _all: true },
    }),
    prisma.setorClickupList.groupBy({
      by: ["clientCompanyId"],
      where: { clientCompanyId: { in: ids }, setor: { companyId }, status: { notIn: ["ENTREGUE", "CANCELADO"] } },
      _count: { _all: true },
    }),
  ]);
  return {
    tickets: new Map(tickets.map((t) => [t.clientCompanyId!, t._count._all])),
    projects: new Map(projects.map((p) => [p.clientCompanyId!, p._count._all])),
  };
}

// ─── grupos_pendentes ─────────────────────────────────────────────────────────

export const gruposPendentes: ToolDef<{ horasSemResposta?: number; incluirRespondidos?: boolean; limite?: number }> = {
  name: "grupos_pendentes",
  description:
    "Triagem dos GRUPOS de WhatsApp: quais grupos de cliente pediram algo e estão sem resposta nossa, há quanto tempo, com quem está atribuído e quantos chamados/projetos abertos aquele cliente tem. Quando alguém da equipe só REAGIU (emoji) à última mensagem do cliente, o grupo vem com vistoPelaEquipe=true e CONTINUA na lista: reagir é dar ciência, não responder. Use quando o usuário perguntar 'o que está pendente nos grupos', 'algum cliente sem retorno', 'o que precisa de atendimento hoje'. Para ver a conversa em si e quem respondeu o quê, use historico_grupo depois.",
  input_schema: {
    type: "object",
    properties: {
      horasSemResposta: { type: "number", description: "Só grupos parados há pelo menos N horas. Default 0 (todos)." },
      incluirRespondidos: { type: "boolean", description: "true = inclui grupos cuja última mensagem foi nossa (já respondidos). Default false." },
      limite: { type: "number", description: "Máximo de grupos na resposta. Default 15." },
    },
  },
  run: async (input, ctx) => {
    const limite = Math.min(Math.max(input.limite ?? 15, 1), 40);
    const minHoras = Math.max(input.horasSemResposta ?? 0, 0);
    const incluirRespondidos = input.incluirRespondidos === true;

    const convs = await prisma.conversation.findMany({
      where: {
        companyId: ctx.companyId,
        isGroup: true,
        syncBlocked: false,
        status: incluirRespondidos ? { not: "CLOSED" } : { notIn: [...STATUS_RESOLVIDO] },
        ...(incluirRespondidos ? {} : { lastMessageDirection: "INBOUND" }),
      },
      orderBy: { lastMessageAt: "asc" }, // mais parado primeiro
      take: 120,
      select: {
        id: true, phone: true, status: true, unreadCount: true,
        lastMessageAt: true, lastMessageBody: true, lastMessageDirection: true,
        scheduledReturnAt: true, returnNote: true,
        assignee: { select: { name: true } },
        setor: { select: { name: true } },
      },
    });

    const elegiveis = convs.filter((c) => {
      const h = horasDesde(c.lastMessageAt, ctx.now);
      return h !== null && h >= minHoras;
    });
    if (elegiveis.length === 0) {
      return ok(
        minHoras > 0
          ? `Nenhum grupo parado há ${minHoras}h ou mais. Tudo respondido.`
          : "Nenhum grupo de WhatsApp aguardando resposta nossa.",
        { data: { grupos: [] } },
      );
    }

    const alvo = elegiveis.slice(0, limite);
    const jids = alvo.map((c) => c.phone);

    // Quem falou por último dentro do grupo (participante do cliente) + chamados
    // abertos que nasceram DESTE grupo (Ticket.phone = JID).
    const [contatos, fonesEquipe, ultimas, ticketsDoGrupo] = await Promise.all([
      loadGroupContacts(ctx.companyId, jids),
      loadFonesEquipe(ctx.companyId),
      prisma.message.findMany({
        where: { companyId: ctx.companyId, phone: { in: jids } },
        orderBy: { receivedAt: "desc" },
        take: jids.length * 6,
        select: { phone: true, direction: true, participantName: true, participantPhone: true, receivedAt: true, reactions: true },
      }),
      prisma.ticket.findMany({
        where: { companyId: ctx.companyId, phone: { in: jids }, status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { id: true, title: true, phone: true, status: true, dueDate: true },
      }),
    ]);

    // Autor e reações da ÚLTIMA mensagem do cliente em cada grupo. A reação
    // interessa porque um 👍 nosso é "vi", não "respondi": o grupo continua na
    // lista, só deixa de parecer abandonado.
    const souNos = new Set([...fonesEquipe, ...lidsDaEquipe(ultimas)]);
    const autorPorJid = new Map<string, string>();
    const reacoesPorJid = new Map<string, Reacao[]>();
    for (const m of ultimas) {
      if (autorPorJid.has(m.phone) || m.direction !== "INBOUND") continue;
      autorPorJid.set(m.phone, m.participantName ?? m.participantPhone ?? "participante");
      reacoesPorJid.set(m.phone, lerReacoes(m.reactions, souNos));
    }
    const ticketsPorJid = new Map<string, typeof ticketsDoGrupo>();
    for (const t of ticketsDoGrupo) {
      const arr = ticketsPorJid.get(t.phone!) ?? [];
      arr.push(t);
      ticketsPorJid.set(t.phone!, arr);
    }

    const work = await loadClientWork(
      ctx.companyId,
      alvo.map((c) => contatos.get(c.phone)?.clientId).filter((x): x is string => !!x),
    );

    const linhas: string[] = [];
    const data: unknown[] = [];
    for (const c of alvo) {
      const ct = contatos.get(c.phone);
      const nome = ct?.name ?? c.phone;
      const h = horasDesde(c.lastMessageAt, ctx.now);
      const partes: string[] = [];
      partes.push(ct?.clientName ? `cliente ${ct.clientName}` : "sem cliente vinculado");
      partes.push(
        c.lastMessageDirection === "INBOUND"
          ? `aguardando nós há ${tempoHumano(h)}`
          : `nós respondemos há ${tempoHumano(h)}`,
      );
      partes.push(`status ${c.status}`);
      partes.push(c.assignee?.name ? `resp. ${c.assignee.name}` : "SEM RESPONSÁVEL");
      if (c.unreadCount > 0) partes.push(`${c.unreadCount} não lidas`);
      const reacs = reacoesPorJid.get(c.phone) ?? [];
      const vistoPelaEquipe = reacs.some((r) => r.ehEquipe);
      if (vistoPelaEquipe) {
        partes.push(`VISTO pela equipe (${reacs.filter((r) => r.ehEquipe).map((r) => r.emoji).join(" ")}) — reagimos, não respondemos`);
      }
      if (c.status === "SCHEDULED" && c.scheduledReturnAt) partes.push(`retorno ${fmtDateTime(c.scheduledReturnAt)}`);

      const tks = ticketsPorJid.get(c.phone) ?? [];
      const clientTickets = ct?.clientId ? work.tickets.get(ct.clientId) ?? 0 : 0;
      const clientProjects = ct?.clientId ? work.projects.get(ct.clientId) ?? 0 : 0;
      partes.push(
        tks.length > 0
          ? `chamado(s) deste grupo: ${tks.map((t) => `"${t.title}" [${t.status}]`).join(", ")}`
          : clientTickets > 0
            ? `${clientTickets} chamado(s) aberto(s) do cliente (nenhum vindo deste grupo)`
            : "NENHUM chamado aberto",
      );
      if (clientProjects > 0) partes.push(`${clientProjects} projeto(s) ativo(s)`);

      linhas.push(
        `• ${nome} — ${partes.join(" | ")}\n  última (${
          c.lastMessageDirection === "INBOUND" ? autorPorJid.get(c.phone) ?? "cliente" : "nós"
        }): "${trecho(c.lastMessageBody)}"`,
      );
      data.push({
        conversationId: c.id, groupJid: c.phone, groupName: nome,
        clientCompanyId: ct?.clientId ?? null, clientName: ct?.clientName ?? null,
        status: c.status, horasSemResposta: h, assignee: c.assignee?.name ?? null,
        unreadCount: c.unreadCount, lastMessageDirection: c.lastMessageDirection,
        vistoPelaEquipe, reacoesUltimaDoCliente: reacs,
        lastMessageAt: c.lastMessageAt, lastMessageBody: c.lastMessageBody,
        ticketsDoGrupo: tks, chamadosAbertosCliente: clientTickets, projetosAtivosCliente: clientProjects,
      });
    }

    const cab = `${alvo.length} grupo(s)${elegiveis.length > alvo.length ? ` de ${elegiveis.length}` : ""} ${
      incluirRespondidos ? "com movimento" : "aguardando resposta nossa"
    }${minHoras > 0 ? ` há ${minHoras}h+` : ""} — do mais parado pro mais recente:`;
    return ok([cab, ...linhas, `Inbox: ${appUrl("/whatsapp")}`].join("\n"), { data: { grupos: data } });
  },
};

// ─── historico_grupo ──────────────────────────────────────────────────────────

export const historicoGrupo: ToolDef<{ grupo: string; limite?: number }> = {
  name: "historico_grupo",
  description:
    "Histórico de um GRUPO de WhatsApp com quem falou cada mensagem — participante do cliente (nome e telefone), atendente nosso (nome), agente de IA (🤖) ou envio automático por instância — mais o contexto de atendimento: cliente vinculado, status da conversa, há quanto tempo está sem resposta, chamados abertos nascidos deste grupo e projetos ativos do cliente. Cada mensagem traz também as REAÇÕES (emoji) que recebeu, em `reacoes: [{emoji, autor, ehEquipe, em}]` e entre chaves no texto — reação da equipe no pedido do cliente é ciência (ela viu), não resposta. Use pra decidir se o que o cliente pediu no grupo já está sendo resolvido. Aceita nome parcial do grupo ou o JID (…@g.us).",
  input_schema: {
    type: "object",
    properties: {
      grupo: { type: "string", description: "Nome (parcial) do grupo ou o JID completo terminando em @g.us." },
      limite: { type: "number", description: "Quantas mensagens trazer, da mais recente pra trás. Default 30, máx 120." },
    },
    required: ["grupo"],
  },
  run: async (input, ctx) => {
    const termo = (input.grupo ?? "").trim();
    if (!termo) return fail("Informe o nome ou o JID do grupo.");
    const limite = Math.min(Math.max(input.limite ?? 30, 1), 120);

    // 1. Resolver o grupo
    let jid: string | null = termo.includes("@g.us") ? termo : null;
    if (!jid) {
      const cands = await prisma.companyContact.findMany({
        where: {
          isGroup: true,
          name: { contains: termo, mode: "insensitive" },
          OR: [{ companyId: ctx.companyId }, { company: { parentCompanyId: ctx.companyId } }],
        },
        select: { phone: true, name: true, company: { select: { name: true, parentCompanyId: true } } },
        take: 10,
      });
      // O MESMO grupo costuma ter contato sob a agência E sob a empresa-cliente.
      // É um JID só, não dois grupos: sem deduplicar, toda busca por nome caía
      // no "vários grupos batem" e não dava pra abrir nada pelo nome.
      const porJid = new Map<string, (typeof cands)[number]>();
      for (const c of cands) {
        const prev = porJid.get(c.phone);
        // Contato do cliente ganha do contato da agência — é o vínculo real.
        if (prev && c.company.parentCompanyId !== ctx.companyId) continue;
        porJid.set(c.phone, c);
      }
      const unicos = [...porJid.values()];

      const comConversa = unicos.length
        ? await prisma.conversation.findMany({
            where: { companyId: ctx.companyId, isGroup: true, phone: { in: unicos.map((c) => c.phone) } },
            select: { phone: true },
          })
        : [];
      const validos = unicos.filter((c) => comConversa.some((v) => v.phone === c.phone));
      const lista = validos.length > 0 ? validos : unicos;
      if (lista.length === 0) return fail(`Nenhum grupo com "${termo}" no nome. Use grupos_pendentes pra ver os grupos ativos.`);
      if (lista.length > 1) {
        return ok(
          `Vários grupos batem com "${termo}" — repita com o nome exato ou o JID:\n${lista
            .map((c) => `• ${c.name ?? c.phone}${c.company.parentCompanyId === ctx.companyId ? ` (cliente ${c.company.name})` : ""} — ${c.phone}`)
            .join("\n")}`,
          { data: { candidatos: lista } },
        );
      }
      jid = lista[0].phone;
    }

    // 2. Conversa + contexto
    const conv = await prisma.conversation.findUnique({
      where: { companyId_phone: { companyId: ctx.companyId, phone: jid } },
      select: {
        id: true, phone: true, status: true, unreadCount: true,
        lastMessageAt: true, lastMessageDirection: true,
        scheduledReturnAt: true, returnNote: true, firstResponseAt: true, aiMode: true,
        assignee: { select: { name: true } },
        setor: { select: { name: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 3, select: { body: true, authorName: true, createdAt: true, type: true } },
      },
    });

    const contatos = await loadGroupContacts(ctx.companyId, [jid]);
    const ct = contatos.get(jid);
    const clientId = ct?.clientId ?? null;

    const [msgs, fonesEquipe, ticketsGrupo, ticketsCliente, projetos] = await Promise.all([
      prisma.message.findMany({
        where: { companyId: ctx.companyId, phone: jid },
        orderBy: { receivedAt: "desc" },
        take: limite,
        select: {
          id: true, body: true, direction: true, receivedAt: true,
          participantName: true, participantPhone: true,
          sentByAI: true, deletedAt: true, mediaType: true,
          quotedBody: true,
          reactions: true,
          sentBy: { select: { name: true } },
          instance: { select: { instanceName: true, label: true, phone: true } },
        },
      }),
      loadFonesEquipe(ctx.companyId),
      prisma.ticket.findMany({
        where: { companyId: ctx.companyId, phone: jid },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, status: true, dueDate: true, assignee: { select: { name: true } } },
      }),
      clientId
        ? prisma.ticket.findMany({
            where: { companyId: ctx.companyId, clientCompanyId: clientId, status: { in: ["OPEN", "IN_PROGRESS"] } },
            orderBy: { dueDate: "asc" },
            take: 10,
            select: { id: true, title: true, status: true, dueDate: true, phone: true, assignee: { select: { name: true } } },
          })
        : Promise.resolve([]),
      clientId
        ? prisma.setorClickupList.findMany({
            where: { clientCompanyId: clientId, setor: { companyId: ctx.companyId }, status: { notIn: ["ENTREGUE", "CANCELADO"] } },
            take: 10,
            select: { id: true, name: true, status: true, dueDate: true },
          })
        : Promise.resolve([]),
    ]);

    if (msgs.length === 0 && !conv) return fail(`Grupo ${jid} não tem conversa nem mensagens nesta empresa.`);

    // Nosso lado = instâncias da empresa + quem já enviou mensagem por nós aqui.
    const souNos = new Set([...fonesEquipe, ...lidsDaEquipe(msgs)]);

    // 3. Montar saída
    const nome = ct?.name ?? jid;
    const h = horasDesde(conv?.lastMessageAt ?? msgs[0]?.receivedAt, ctx.now);
    const out: string[] = [];
    out.push(`Grupo: ${nome} (${jid})`);
    out.push(`Cliente: ${ct?.clientName ?? "NÃO VINCULADO a nenhuma empresa-cliente"}`);
    if (conv) {
      const st: string[] = [`status ${conv.status}`, conv.assignee?.name ? `responsável ${conv.assignee.name}` : "SEM RESPONSÁVEL"];
      if (conv.setor?.name) st.push(`setor ${conv.setor.name}`);
      if (conv.unreadCount > 0) st.push(`${conv.unreadCount} não lidas`);
      st.push(conv.lastMessageDirection === "INBOUND" ? `AGUARDANDO NOSSA RESPOSTA há ${tempoHumano(h)}` : `última fala foi nossa, há ${tempoHumano(h)}`);
      if (conv.aiMode !== "ACTIVE") st.push(`agente IA ${conv.aiMode}`);
      if (conv.scheduledReturnAt) st.push(`retorno agendado ${fmtDateTime(conv.scheduledReturnAt)}${conv.returnNote ? ` (${conv.returnNote})` : ""}`);
      out.push(`Atendimento: ${st.join(" | ")}`);
    } else {
      out.push("Atendimento: sem registro de conversa (mensagens legadas).");
    }

    out.push(
      ticketsGrupo.length > 0
        ? `Chamados abertos DESTE grupo: ${ticketsGrupo
            .map((t) => `"${t.title}" [${t.status}, ${t.assignee?.name ?? "sem responsável"}, prazo ${fmtDateTime(t.dueDate)}]`)
            .join("; ")}`
        : "Chamados abertos DESTE grupo: nenhum — nada que foi pedido aqui virou chamado.",
    );
    const outros = ticketsCliente.filter((t) => t.phone !== jid);
    if (outros.length > 0) {
      out.push(
        `Outros chamados abertos do cliente: ${outros
          .map((t) => `"${t.title}" [${t.status}, ${t.assignee?.name ?? "sem responsável"}, prazo ${fmtDateTime(t.dueDate)}]`)
          .join("; ")}`,
      );
    }
    out.push(
      projetos.length > 0
        ? `Projetos ativos do cliente: ${projetos.map((p) => `${p.name} [${p.status}]`).join("; ")}`
        : "Projetos ativos do cliente: nenhum",
    );
    if (conv?.notes?.length) {
      out.push(`Notas internas recentes: ${conv.notes.map((n) => `${n.authorName}: "${trecho(n.body, 70)}"`).join(" | ")}`);
    }

    out.push("", `Últimas ${msgs.length} mensagens (mais antiga primeiro):`);
    for (const m of msgs.slice().reverse()) {
      let quem: string;
      if (m.direction === "INBOUND") {
        const p = m.participantName ?? m.participantPhone ?? "participante";
        quem = m.participantName && m.participantPhone ? `${p} (${m.participantPhone})` : p;
      } else if (m.sentByAI) {
        quem = `🤖 agente IA · instância ${nomeInstancia(m.instance)}`;
      } else if (m.sentBy?.name) {
        quem = `NÓS · ${m.sentBy.name} · instância ${nomeInstancia(m.instance)}`;
      } else {
        quem = `NÓS · autor não registrado (envio automático) · instância ${nomeInstancia(m.instance)}`;
      }
      const flags: string[] = [];
      if (m.deletedAt) flags.push("APAGADA");
      if (m.mediaType) flags.push(m.mediaType.startsWith("image") ? "imagem" : m.mediaType.startsWith("audio") ? "áudio" : m.mediaType);
      const resp = m.quotedBody ? ` ↩︎ em resposta a "${trecho(m.quotedBody, 40)}"` : "";
      // Reação é sinal de leitura, não de resposta: um 👍 nosso no pedido do
      // cliente quer dizer "vi", e é isso que a linha precisa mostrar.
      const reacs = reacoesTexto(lerReacoes(m.reactions, souNos));
      out.push(`[${fmtDateTime(m.receivedAt)}] ${quem}${flags.length ? ` {${flags.join(", ")}}` : ""}: ${trecho(m.body, 300)}${resp}${reacs}`);
    }

    out.push("", `Inbox: ${appUrl(`/whatsapp?abrir=${encodeURIComponent(jid)}`)}`);
    return ok(out.join("\n"), {
      data: {
        groupJid: jid, groupName: nome,
        clientCompanyId: clientId, clientName: ct?.clientName ?? null,
        conversa: conv, ticketsDoGrupo: ticketsGrupo, ticketsDoCliente: ticketsCliente, projetos,
        mensagens: msgs
          .slice()
          .reverse()
          .map(({ reactions, ...m }) => ({ ...m, reacoes: lerReacoes(reactions, souNos) })),
      },
    });
  },
};

export const gruposTools: ToolDef[] = [gruposPendentes, historicoGrupo];

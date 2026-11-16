import { prisma } from "@/lib/prisma";
import { logFinance } from "@/lib/finance-log";
import { getUserPermissions } from "@/lib/user-permissions";
import {
  ACCEPTANCE_TYPES, ACCEPTANCE_LABEL, CONTRACT_STATUS_LABEL, ContractError, confirmBilling,
  describeSoldServices, markContractSent, productionBlocker, recordAcceptance, type SoldService,
} from "@/lib/sale-contract";
import { buildClientTimeline, TIMELINE_LABEL, TIMELINE_TYPES, type TimelineType } from "@/lib/client-central";
import { setEmailClient } from "@/lib/client-email-link";
import { createClientDocument, DocumentError } from "@/lib/client-documents";
import { type ToolDef, type ToolContext, ok, fail, appUrl, parseDate, fmtDate, fmtDateTime } from "./types";

/**
 * Central do Cliente pelo Claude: contrato (envio, aceite, faturamento
 * confirmado, liberação da produção), e-mails ligados ao cliente, documentos
 * e linha do tempo. As regras são as mesmas da tela (lib/sale-contract).
 *
 * "contratoId" = id da venda da esteira (aparece em resumo_cliente).
 */

const actorOf = (ctx: ToolContext) => ({ name: ctx.userName });

/** Erros de regra viram resposta legível pro modelo; o resto sobe. */
function asFail(e: unknown) {
  if (e instanceof ContractError || e instanceof DocumentError) return fail(e.message);
  throw e;
}

/** "Fulano <a@b.com>" → nome + email. */
function splitPerson(s: string | undefined | null): { name: string | null; email: string | null } {
  const t = (s ?? "").trim();
  if (!t) return { name: null, email: null };
  const m = t.match(/^(.*?)\s*<([^>]+@[^>]+)>$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  if (/^[^\s@]+@[^\s@]+$/.test(t)) return { name: null, email: t };
  return { name: t, email: null };
}

async function saleOf(contratoId: string, ctx: ToolContext) {
  return prisma.sale.findFirst({
    where: { id: contratoId, companyId: ctx.companyId },
    include: { clientCompany: { select: { id: true, name: true } } },
  });
}

export const registrarEnvioContrato: ToolDef<{ contratoId: string; tipoDocumento?: string; dataEnvio?: string }> = {
  name: "registrar_envio_contrato",
  description:
    "Registra que o contrato (ou termo) da venda foi ENVIADO ao cliente. contratoId = id da venda (ver resumo_cliente). tipoDocumento CONTRATO | TERMO. Não marca aceite — pra isso use registrar_aceite.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      contratoId: { type: "string" },
      tipoDocumento: { type: "string", enum: ["CONTRATO", "TERMO"] },
      dataEnvio: { type: "string", description: "ISO 8601 com fuso. Default: agora." },
    },
    required: ["contratoId"],
  },
  run: async (i, ctx) => {
    const sale = await saleOf(i.contratoId, ctx);
    if (!sale) return fail("Contrato (venda) não encontrado. Pegue o id em resumo_cliente.");
    try {
      const s = await markContractSent(sale.id, { sentAt: parseDate(i.dataEnvio), contractDocType: i.tipoDocumento ?? null }, ctx.companyId, actorOf(ctx));
      return ok(`${s.contractDocType === "TERMO" ? "Termo" : "Contrato"} de "${sale.title}" registrado como enviado em ${fmtDate(s.contractSentAt)}. Status: ${CONTRACT_STATUS_LABEL[s.contractStatus]}.`, {
        link: sale.clientCompany ? appUrl(`/empresas/${sale.clientCompany.id}#contrato`) : appUrl("/financeiro/esteira"),
      });
    } catch (e) { return asFail(e); }
  },
};

export const registrarAceite: ToolDef<{
  contratoId: string; tipoAceite: string; linkAceite?: string; dataAceite?: string;
  aceitoPor?: string; emailId?: string; tipoDocumento?: string;
}> = {
  name: "registrar_aceite",
  description:
    "Registra o ACEITE do contrato/termo de uma venda: tipo (AUTENTIQUE | EMAIL | GOHUB | OUTRO), link do comprovante, data e quem aceitou ('Nome <email>'). Com isso o contrato passa a Aceito — sem aceite registrado ele não fica aceito. Se o aceite veio por email da caixa, passe emailId: link, data e remetente saem do próprio email e ele fica marcado como 'aceite' no cliente.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      contratoId: { type: "string", description: "Id da venda (resumo_cliente)." },
      tipoAceite: { type: "string", enum: [...ACCEPTANCE_TYPES] },
      linkAceite: { type: "string", description: "URL do documento no Autentique, do email de 'de acordo' etc." },
      dataAceite: { type: "string", description: "ISO 8601 com fuso. Default: data do email ou agora." },
      aceitoPor: { type: "string", description: "Quem aceitou: 'Nome <email>', só nome ou só email." },
      emailId: { type: "string", description: "Email da caixa que é o aceite (listar_emails)." },
      tipoDocumento: { type: "string", enum: ["CONTRATO", "TERMO"] },
    },
    required: ["contratoId", "tipoAceite"],
  },
  run: async (i, ctx) => {
    const sale = await saleOf(i.contratoId, ctx);
    if (!sale) return fail("Contrato (venda) não encontrado. Pegue o id em resumo_cliente.");
    const p = splitPerson(i.aceitoPor);
    try {
      const s = await recordAcceptance(sale.id, {
        acceptanceType: (i.tipoAceite ?? "").toUpperCase(),
        acceptanceUrl: i.linkAceite ?? null,
        acceptedAt: parseDate(i.dataAceite),
        acceptedByName: p.name, acceptedByEmail: p.email,
        emailId: i.emailId ?? null,
        contractDocType: i.tipoDocumento ?? null,
      }, ctx.companyId, actorOf(ctx));
      const blocker = productionBlocker(s);
      return ok([
        `Aceite registrado em "${sale.title}": ${ACCEPTANCE_LABEL[s.acceptanceType ?? ""] ?? s.acceptanceType}, ${fmtDateTime(s.acceptedAt)}, por ${[s.acceptedByName, s.acceptedByEmail].filter(Boolean).join(" · ")}.`,
        s.acceptanceUrl ? `Comprovante: ${s.acceptanceUrl.startsWith("/") ? appUrl(s.acceptanceUrl) : s.acceptanceUrl}` : null,
        blocker ? `Produção ainda travada: ${blocker}` : "Aceite + faturamento confirmado: a produção já pode ser liberada (liberar_producao).",
      ].filter(Boolean).join("\n"), {
        link: sale.clientCompany ? appUrl(`/empresas/${sale.clientCompany.id}#contrato`) : appUrl("/financeiro/esteira"),
      });
    } catch (e) { return asFail(e); }
  },
};

export const confirmarFaturamento: ToolDef<{
  contratoId: string; confirmadoPor?: string; linkConfirmacao?: string; data?: string;
  instrucoesCobranca?: string; emailId?: string;
}> = {
  name: "confirmar_faturamento",
  description:
    "Registra que o faturamento da venda foi CONFIRMADO (ex.: a Kelly do financeiro deu o ok): quem confirmou, link do email/mensagem e, se vier, as instruções de cobrança (valor, forma, vencimento, recorrência, entrada). Não lança cobrança. Com emailId, o email fica marcado como 'confirmação de faturamento' no cliente.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      contratoId: { type: "string", description: "Id da venda (resumo_cliente)." },
      confirmadoPor: { type: "string", description: "Nome de quem confirmou (ex.: Kelly)." },
      linkConfirmacao: { type: "string" },
      data: { type: "string", description: "ISO 8601 com fuso. Default: data do email ou agora." },
      instrucoesCobranca: { type: "string" },
      emailId: { type: "string", description: "Email da caixa que é a confirmação." },
    },
    required: ["contratoId"],
  },
  run: async (i, ctx) => {
    const sale = await saleOf(i.contratoId, ctx);
    if (!sale) return fail("Contrato (venda) não encontrado. Pegue o id em resumo_cliente.");
    try {
      const s = await confirmBilling(sale.id, {
        confirmedBy: i.confirmadoPor ?? null,
        confirmationUrl: i.linkConfirmacao ?? null,
        confirmedAt: parseDate(i.data),
        emailId: i.emailId ?? null,
        instructions: i.instrucoesCobranca ?? null,
      }, ctx.companyId, actorOf(ctx));
      const blocker = productionBlocker(s);
      return ok([
        `Faturamento de "${sale.title}" confirmado por ${s.billingConfirmedBy} em ${fmtDate(s.billingConfirmedAt)}.`,
        s.billingInstructions ? `Instruções: ${s.billingInstructions}` : null,
        blocker ? `Produção ainda travada: ${blocker}` : "Aceite + faturamento confirmado: a produção já pode ser liberada (liberar_producao).",
      ].filter(Boolean).join("\n"));
    } catch (e) { return asFail(e); }
  },
};

export const liberarProducao: ToolDef<{ contratoId: string; projetoId?: string; nomeProjeto?: string }> = {
  name: "liberar_producao",
  description:
    "Libera a venda para PRODUÇÃO e liga ao projeto que entrega: um projeto existente (projetoId) ou um novo (nomeProjeto, criado já em andamento com os serviços vendidos no detalhamento). Só funciona com o aceite do contrato registrado e o faturamento confirmado — senão devolve o que falta.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      contratoId: { type: "string" },
      projetoId: { type: "string", description: "Projeto existente (listar_projetos)." },
      nomeProjeto: { type: "string", description: "Cria um projeto novo com este nome." },
    },
    required: ["contratoId"],
  },
  run: async (i, ctx) => {
    const sale = await saleOf(i.contratoId, ctx);
    if (!sale) return fail("Contrato (venda) não encontrado.");
    if (sale.productionStatus === "LIBERADO" || sale.productionStatus === "ENTREGUE") {
      return ok(`"${sale.title}" já está ${sale.productionStatus === "LIBERADO" ? "em produção" : "entregue"}.`);
    }
    const blocker = productionBlocker(sale);
    if (blocker) return fail(blocker);

    let projectId = sale.projectId;
    if (i.projetoId) {
      const p = await prisma.setorClickupList.findFirst({ where: { id: i.projetoId, setor: { companyId: ctx.companyId } }, select: { id: true } });
      if (!p) return fail("Projeto não encontrado nesta empresa.");
      projectId = p.id;
    } else if (!projectId) {
      const nome = (i.nomeProjeto ?? "").trim() || sale.title;
      const setor = await prisma.setor.findFirst({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!setor) return fail("Nenhum setor cadastrado — crie um setor antes de abrir projetos.");
      const servicos = Array.isArray(sale.soldServices) ? (sale.soldServices as unknown as SoldService[]) : [];
      const p = await prisma.setorClickupList.create({
        data: {
          setorId: setor.id, name: nome, clientCompanyId: sale.clientCompanyId, status: "EM_ANDAMENTO",
          description: [
            `Entrega da venda "${sale.title}".`,
            servicos.length ? `\nServiços vendidos:\n${describeSoldServices(servicos)}` : "",
            sale.billingInstructions ? `\nCobrança: ${sale.billingInstructions}` : "",
          ].join(""),
        },
        select: { id: true },
      });
      projectId = p.id;
    }

    const updated = await prisma.sale.update({
      where: { id: sale.id },
      data: { productionStatus: "LIBERADO", releasedAt: sale.releasedAt ?? new Date(), deliveredAt: null, projectId },
      include: { project: { select: { id: true, name: true } } },
    });
    await logFinance({
      companyId: ctx.companyId, clientCompanyId: sale.clientCompanyId, entity: "CONTRATO", entityId: sale.id,
      action: "PRODUCAO_LIBERADA",
      description: updated.project ? `Produção liberada — projeto "${updated.project.name}"` : "Produção liberada",
      meta: { venda: sale.title, projectId }, session: { user: { name: ctx.userName } },
    });
    return ok(`Produção de "${sale.title}" liberada${updated.project ? ` no projeto "${updated.project.name}"` : ""}.`, {
      link: updated.project ? appUrl(`/projetos/${updated.project.id}`) : appUrl("/financeiro/esteira"),
    });
  },
};

export const vincularEmailCliente: ToolDef<{ emailId: string; clientCompanyId: string; marcarComo?: string; contratoId?: string; pessoa?: string }> = {
  name: "vincular_email_cliente",
  description:
    "Liga um email da caixa a um cliente (aparece na aba E-mails e na linha do tempo dele). marcarComo ACEITE ou FATURAMENTO também registra o aceite do contrato / a confirmação do faturamento a partir desse email — informe contratoId (dispensável quando o cliente tem uma venda só). pessoa = quem aceitou/confirmou, se o email for nosso (enviado).",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      emailId: { type: "string" },
      clientCompanyId: { type: "string" },
      marcarComo: { type: "string", enum: ["ACEITE", "FATURAMENTO"] },
      contratoId: { type: "string" },
      pessoa: { type: "string" },
    },
    required: ["emailId", "clientCompanyId"],
  },
  run: async (i, ctx) => {
    const client = await prisma.company.findFirst({ where: { id: i.clientCompanyId, parentCompanyId: ctx.companyId }, select: { id: true, name: true } });
    if (!client) return fail("Cliente não encontrado na carteira.");
    const perms = await getUserPermissions({ user: { id: ctx.userId, role: ctx.role, companyId: ctx.companyId } });
    const contas = perms && !perms.isAdmin ? perms.emailAccountIds : null;
    const email = await prisma.inboxEmail.findFirst({
      where: { id: i.emailId, companyId: ctx.companyId, ...(contas ? { accountId: { in: contas } } : {}) },
      select: { id: true, subject: true },
    });
    if (!email) return fail("Email não encontrado (ou de uma caixa que você não pode ler).");
    await setEmailClient(ctx.companyId, email.id, client.id);

    if (!i.marcarComo) return ok(`Email "${email.subject || "(sem assunto)"}" ligado a ${client.name}.`, { link: appUrl(`/empresas/${client.id}#emails`) });

    let contratoId = i.contratoId;
    if (!contratoId) {
      const sales = await prisma.sale.findMany({ where: { clientCompanyId: client.id, companyId: ctx.companyId }, select: { id: true, title: true } });
      if (sales.length !== 1) {
        return fail(`Email ligado a ${client.name}, mas pra marcar como ${i.marcarComo} preciso do contratoId. Vendas do cliente: ${sales.map((s) => `${s.title} (id=${s.id})`).join("; ") || "nenhuma"}.`);
      }
      contratoId = sales[0].id;
    }
    const sale = await prisma.sale.findFirst({ where: { id: contratoId, clientCompanyId: client.id, companyId: ctx.companyId }, select: { id: true, title: true } });
    if (!sale) return fail("Esse contrato não é deste cliente.");
    const p = splitPerson(i.pessoa);
    try {
      if (i.marcarComo === "ACEITE") {
        await recordAcceptance(sale.id, { acceptanceType: "EMAIL", emailId: email.id, acceptedByName: p.name, acceptedByEmail: p.email }, ctx.companyId, actorOf(ctx));
        return ok(`Email ligado a ${client.name} e registrado como ACEITE de "${sale.title}".`, { link: appUrl(`/empresas/${client.id}#contrato`) });
      }
      await confirmBilling(sale.id, { emailId: email.id, confirmedBy: p.name ?? p.email }, ctx.companyId, actorOf(ctx));
      return ok(`Email ligado a ${client.name} e registrado como CONFIRMAÇÃO DE FATURAMENTO de "${sale.title}".`, { link: appUrl(`/empresas/${client.id}#contrato`) });
    } catch (e) { return asFail(e); }
  },
};

export const anexarDocumento: ToolDef<{ clientCompanyId: string; tipo: string; link: string; titulo: string; contratoId?: string; data?: string }> = {
  name: "anexar_documento",
  description:
    "Anexa um documento (por link) aos Documentos do cliente: PROPOSTA | CONTRATO | TERMO | ADITIVO | BRIEFING | ENTREGA | OUTRO. Proposta entra na linha do tempo como 'proposta enviada'. contratoId liga à venda.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      tipo: { type: "string", enum: ["PROPOSTA", "CONTRATO", "TERMO", "ADITIVO", "BRIEFING", "ENTREGA", "OUTRO"] },
      link: { type: "string", description: "URL (Drive, Autentique…)." },
      titulo: { type: "string" },
      contratoId: { type: "string" },
      data: { type: "string", description: "Data do documento, ISO 8601 com fuso." },
    },
    required: ["clientCompanyId", "tipo", "link", "titulo"],
  },
  run: async (i, ctx) => {
    const client = await prisma.company.findFirst({ where: { id: i.clientCompanyId, parentCompanyId: ctx.companyId }, select: { id: true, name: true } });
    if (!client) return fail("Cliente não encontrado na carteira.");
    try {
      const d = await createClientDocument({
        agencyId: ctx.companyId, clientCompanyId: client.id, type: i.tipo, title: i.titulo, url: i.link,
        saleId: i.contratoId ?? null, documentDate: parseDate(i.data),
        createdById: ctx.userId, createdByName: ctx.userName,
      });
      return ok(`Documento "${d.title}" (${d.type}) anexado a ${client.name}. id=${d.id}`, { link: appUrl(`/empresas/${client.id}#documentos`) });
    } catch (e) { return asFail(e); }
  },
};

export const linhaDoTempoCliente: ToolDef<{ clientCompanyId: string; desde?: string; tipos?: string[]; limite?: number }> = {
  name: "linha_do_tempo_cliente",
  description:
    `Linha do tempo do cliente, do mais recente pro mais antigo: lead, proposta, venda, contrato enviado/aceito, faturamento confirmado, cobranças (lançada/paga/atrasada), projeto criado/liberado/entregue, chamados, conversas do WhatsApp (contatos/grupos do cliente), emails marcados ou importantes, documentos e suas anotações. Cada evento com data, tipo, resumo, quem fez e link. Filtre por tipos (${TIMELINE_TYPES.join(", ")}) e desde (ISO).`,
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      desde: { type: "string" },
      tipos: { type: "array", items: { type: "string", enum: [...TIMELINE_TYPES] } },
      limite: { type: "number", description: "Default 40, máximo 200." },
    },
    required: ["clientCompanyId"],
  },
  run: async (i, ctx) => {
    const client = await prisma.company.findFirst({ where: { id: i.clientCompanyId, parentCompanyId: ctx.companyId }, select: { id: true, name: true } });
    if (!client) return fail("Cliente não encontrado na carteira.");
    const perms = await getUserPermissions({ user: { id: ctx.userId, role: ctx.role, companyId: ctx.companyId } });
    const tipos = (i.tipos ?? []).map((t) => t.toUpperCase()).filter((t): t is TimelineType => (TIMELINE_TYPES as readonly string[]).includes(t));
    const events = await buildClientTimeline(client.id, ctx.companyId, {
      since: parseDate(i.desde),
      types: tipos,
      viewerUserId: ctx.userId,
      emailAccountIds: perms && !perms.isAdmin ? perms.emailAccountIds : null,
      limit: Math.min(Math.max(i.limite ?? 40, 1), 200),
    });
    if (events.length === 0) return ok(`Nada na linha do tempo de ${client.name}${tipos.length ? " com esses tipos" : ""}.`, { data: { events } });
    const lines = events.map((e) => {
      const link = e.link ? ` · ${e.link.startsWith("/") ? appUrl(e.link) : e.link}` : "";
      return `- [${fmtDateTime(new Date(e.at))}] ${TIMELINE_LABEL[e.type]}: ${e.title}${e.summary ? ` — ${e.summary.replace(/\s+/g, " ").slice(0, 140)}` : ""}${e.by ? ` (${e.by})` : ""}${link}`;
    });
    return ok([`Linha do tempo de ${client.name} (${events.length} evento(s)):`, ...lines].join("\n"), {
      data: { events }, link: appUrl(`/empresas/${client.id}#linha-do-tempo`),
    });
  },
};

export const centralTools: ToolDef[] = [
  linhaDoTempoCliente, registrarEnvioContrato, registrarAceite, confirmarFaturamento,
  liberarProducao, vincularEmailCliente, anexarDocumento,
];

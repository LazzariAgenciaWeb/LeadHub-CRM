import { prisma } from "@/lib/prisma";
import { cleanCobranca } from "@/lib/client-service-billing";
import { cleanVigencia } from "@/lib/client-service-vigencia";
import { logFinance } from "@/lib/finance-log";
import { syncProjectStatus } from "@/lib/project-vigencia";
import { type ToolDef, type ToolContext, ok, fail, appUrl, brl } from "./types";

/**
 * Edição do CADASTRO do cliente e dos SERVIÇOS CONTRATADOS (ClientService).
 *
 * Espelha o que as telas já fazem (PATCH /api/companies/[id] e
 * /api/empresas/[id]/servicos-contratados/[csId]) — mesmas regras de vigência
 * e cobrança, mesma trilha no financeiro. Sem isto o assistente enxergava o
 * contrato mas não conseguia registrar "encerra em 31/12".
 */

const STATUSES = ["ATIVO", "EM_IMPLANTACAO", "PAUSADO", "ENCERRADO"] as const;
const TZ = process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo";

/** Data por extenso com ano — vigência sem ano é ambígua. */
function dia(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

/**
 * Data de vigência vinda do modelo. Só a data ("2026-12-31") vira meio-dia de
 * Brasília, igual à tela — meia-noite UTC cairia no dia anterior aqui.
 * undefined = não mexer · null = limpar · "invalid" = recusar.
 */
function vigDate(v: unknown): Date | null | undefined | "invalid" {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T12:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/** Texto opcional: undefined = não mexer; vazio = limpar. */
function txt(v: unknown, max = 300): string | null | undefined {
  if (v === undefined) return undefined;
  return String(v ?? "").trim().slice(0, max) || null;
}

function url(v: unknown): string | null | undefined | "invalid" {
  const t = txt(v, 500);
  if (!t) return t;
  return /^https?:\/\/\S+$/i.test(t) ? t : "invalid";
}

// Contrato é dado financeiro: pelo assistente, só gestor (ADMIN) mexe. A tela
// continua valendo pro atendente com setor de Financeiro liberado.
function podeFinanceiro(ctx: ToolContext): boolean {
  return ctx.isAdmin;
}

function linhaServico(s: {
  id: string; label: string; status: string; amountCents: number | null; isRecurring: boolean;
  billingCycle: string | null; billingDay: number | null; startedAt: Date | null; endedAt: Date | null; renewsAt: Date | null;
}): string {
  const valor = s.amountCents != null
    ? `${brl(s.amountCents)}${s.isRecurring ? `/${(s.billingCycle ?? "MENSAL").toLowerCase()}${s.billingDay ? ` (dia ${s.billingDay})` : ""}` : " (pontual)"}`
    : "sem valor";
  return `- ${s.label} · servicoId=${s.id} · ${s.status} · ${valor} · início ${dia(s.startedAt)} · encerramento ${dia(s.endedAt)}${s.renewsAt ? ` · âncora do ciclo ${dia(s.renewsAt)}` : ""}`;
}

export const atualizarCliente: ToolDef<{
  clientCompanyId: string; name?: string; tradeName?: string | null; document?: string | null; segment?: string | null;
  phone?: string | null; email?: string | null; website?: string | null; billingNotes?: string | null;
  driveFolderUrl?: string | null; clickupListUrl?: string | null;
}> = {
  name: "atualizar_cliente",
  description:
    "Edita o CADASTRO de um cliente da carteira: razão social (name), nome fantasia (tradeName), CNPJ/CPF (document), segmento, telefone, e-mail, site, instruções de cobrança (billingNotes), pasta do Drive e lista do ClickUp. Mande só os campos que mudam; string vazia ou null limpa o campo (menos name). Use buscar_cliente antes pra pegar o clientCompanyId. Pra mexer em serviço/contrato (valor, encerramento) use atualizar_servico_cliente.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      name: { type: "string", description: "Razão social / nome principal do cadastro." },
      tradeName: { type: ["string", "null"], description: "Nome fantasia." },
      document: { type: ["string", "null"], description: "CNPJ ou CPF (com ou sem máscara)." },
      segment: { type: ["string", "null"] },
      phone: { type: ["string", "null"], description: "Com DDD." },
      email: { type: ["string", "null"] },
      website: { type: ["string", "null"] },
      billingNotes: { type: ["string", "null"], description: "Particularidades da cobrança deste cliente (aparece na fila de faturamento)." },
      driveFolderUrl: { type: ["string", "null"] },
      clickupListUrl: { type: ["string", "null"] },
    },
    required: ["clientCompanyId"],
  },
  mutating: true,
  run: async (input, ctx) => {
    if (!ctx.isAdmin) return fail("Só administrador da agência edita o cadastro de cliente.");
    const client = await prisma.company.findFirst({
      where: { id: input.clientCompanyId, parentCompanyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!client) return fail("Cliente não encontrado na carteira.");

    const data: Record<string, string | null> = {};
    if (input.name !== undefined) {
      const n = String(input.name ?? "").trim();
      if (!n) return fail("name não pode ficar vazio.");
      data.name = n.slice(0, 200);
    }
    const simples = { tradeName: 200, segment: 120, email: 200, website: 300 } as const;
    for (const [k, max] of Object.entries(simples)) {
      const v = txt((input as any)[k], max);
      if (v !== undefined) data[k] = v;
    }
    if (input.billingNotes !== undefined) data.billingNotes = txt(input.billingNotes, 4000) ?? null;
    if (input.phone !== undefined) data.phone = String(input.phone ?? "").replace(/\D/g, "") || null;
    // Só dígitos: é a chave de casamento com o Bling (ver PATCH /api/companies/[id]).
    if (input.document !== undefined) {
      const doc = String(input.document ?? "").replace(/\D/g, "");
      if (doc && doc.length !== 11 && doc.length !== 14) return fail("document deve ter 11 (CPF) ou 14 (CNPJ) dígitos.");
      data.document = doc || null;
    }
    for (const k of ["driveFolderUrl", "clickupListUrl"] as const) {
      const v = url(input[k]);
      if (v === "invalid") return fail(`${k} precisa ser um link http(s).`);
      if (v !== undefined) data[k] = v;
    }
    if (!Object.keys(data).length) return fail("Nenhum campo pra alterar.");

    const updated = await prisma.company.update({ where: { id: client.id }, data, select: { id: true, name: true } });
    return ok(`Cadastro de "${updated.name}" atualizado: ${Object.keys(data).join(", ")}.`, {
      data: { id: updated.id, campos: Object.keys(data) },
      link: appUrl(`/empresas/${updated.id}`),
    });
  },
};

export const listarServicosCliente: ToolDef<{ clientCompanyId: string; incluirEncerrados?: boolean }> = {
  name: "listar_servicos_cliente",
  description:
    "Lista os serviços contratados (contratos recorrentes e pontuais) de um cliente com o servicoId de cada um, status, valor, ciclo, dia de vencimento, início e data de encerramento. É daqui que sai o servicoId usado em atualizar_servico_cliente. Por padrão traz também os encerrados.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string" },
      incluirEncerrados: { type: "boolean", description: "Padrão true." },
    },
    required: ["clientCompanyId"],
  },
  run: async (input, ctx) => {
    if (!podeFinanceiro(ctx)) return fail("Só administrador da agência mexe em serviço contratado pelo assistente.");
    const client = await prisma.company.findFirst({
      where: { id: input.clientCompanyId, parentCompanyId: ctx.companyId },
      select: { id: true, name: true },
    });
    if (!client) return fail("Cliente não encontrado na carteira.");
    const rows = await prisma.clientService.findMany({
      where: { clientCompanyId: client.id, ...(input.incluirEncerrados === false ? { status: { not: "ENCERRADO" } } : {}) },
      select: {
        id: true, label: true, status: true, amountCents: true, isRecurring: true, billingCycle: true, billingDay: true,
        startedAt: true, endedAt: true, renewsAt: true, notes: true,
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return ok(
      `Serviços de ${client.name} (${rows.length}):\n${rows.map(linhaServico).join("\n") || "nenhum serviço contratado."}`,
      { data: rows, link: appUrl(`/empresas/${client.id}?aba=financeiro`) },
    );
  },
};

export const atualizarServicoCliente: ToolDef<{
  servicoId: string; label?: string; status?: string; amountCents?: number; isRecurring?: boolean;
  billingCycle?: string; billingDay?: number; startedAt?: string | null; endedAt?: string | null;
  renewsAt?: string | null; notes?: string | null; motivo?: string;
}> = {
  name: "atualizar_servico_cliente",
  description:
    "Edita um serviço contratado do cliente (servicoId vem de listar_servicos_cliente). Mande só o que muda. " +
    "ENCERRAMENTO: endedAt define a data de fim (ISO ou 'YYYY-MM-DD'). Data FUTURA com o status ainda ATIVO = contrato segue sendo faturado até o mês do encerramento e sai da fila depois — é assim que se programa o fim de um recorrente. " +
    "status ENCERRADO sem endedAt carimba hoje; reabrir (status ATIVO num encerrado) limpa a data; endedAt null limpa a data. " +
    "amountCents em CENTAVOS (valor de um ciclo). billingCycle: MENSAL | TRIMESTRAL | ANUAL. renewsAt NÃO é fim de contrato: é a âncora do ciclo trimestral/anual. " +
    "Altera faturamento futuro: confirme com o usuário antes de chamar e passe o motivo.",
  input_schema: {
    type: "object",
    properties: {
      servicoId: { type: "string" },
      label: { type: "string" },
      status: { type: "string", enum: [...STATUSES] },
      amountCents: { type: "integer", minimum: 0 },
      isRecurring: { type: "boolean" },
      billingCycle: { type: "string", enum: ["MENSAL", "TRIMESTRAL", "ANUAL"] },
      billingDay: { type: "integer", minimum: 1, maximum: 31 },
      startedAt: { type: ["string", "null"] },
      endedAt: { type: ["string", "null"], description: "Data de encerramento. null limpa." },
      renewsAt: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      motivo: { type: "string", description: "Por que mudou — fica na trilha do financeiro." },
    },
    required: ["servicoId"],
  },
  mutating: true,
  confirm: true,
  summarize: (i) =>
    `Alterar serviço contratado ${i.servicoId}: ${Object.keys(i).filter((k) => k !== "servicoId" && k !== "motivo").map((k) => `${k}=${(i as any)[k]}`).join(", ")}`,
  run: async (input, ctx) => {
    if (!podeFinanceiro(ctx)) return fail("Só administrador da agência mexe em serviço contratado pelo assistente.");
    const cs = await prisma.clientService.findFirst({
      where: { id: input.servicoId, clientCompany: { parentCompanyId: ctx.companyId } },
      include: { clientCompany: { select: { id: true, name: true } } },
    });
    if (!cs) return fail("Serviço contratado não encontrado na carteira. Use listar_servicos_cliente pra pegar o servicoId.");

    const data: Record<string, unknown> = {};
    if (input.label !== undefined) {
      const l = String(input.label ?? "").trim();
      if (!l) return fail("label não pode ficar vazio.");
      data.label = l.slice(0, 200);
    }
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status as any)) return fail(`status inválido. Use: ${STATUSES.join(", ")}.`);
      data.status = input.status;
    }
    if (input.notes !== undefined) data.notes = txt(input.notes, 4000) ?? null;

    const inicio = vigDate(input.startedAt);
    const fim = vigDate(input.endedAt);
    const ancora = vigDate(input.renewsAt);
    if (inicio === "invalid" || fim === "invalid" || ancora === "invalid") return fail("Data inválida. Use ISO 8601 ou 'YYYY-MM-DD'.");
    if (ancora !== undefined) data.renewsAt = ancora;
    const inicioFinal = inicio !== undefined ? inicio : cs.startedAt;
    if (fim && inicioFinal && fim < inicioFinal) return fail(`Encerramento (${dia(fim)}) antes do início (${dia(inicioFinal)}).`);

    // Cobrança vai em bloco (mesma regra da tela): o que não veio mantém o atual.
    if (input.amountCents !== undefined || input.isRecurring !== undefined || input.billingCycle !== undefined || input.billingDay !== undefined) {
      Object.assign(data, cleanCobranca({
        amountCents: input.amountCents ?? cs.amountCents,
        isRecurring: input.isRecurring ?? cs.isRecurring,
        billingCycle: input.billingCycle ?? cs.billingCycle,
        billingDay: input.billingDay ?? cs.billingDay,
      }));
    }

    Object.assign(data, cleanVigencia(
      {
        ...(inicio !== undefined && { startedAt: inicio ? inicio.toISOString() : null }),
        ...(fim !== undefined && { endedAt: fim ? fim.toISOString() : null }),
      },
      data.status as string | undefined,
      cs.status,
      cs.endedAt,
    ));
    if (!Object.keys(data).length) return fail("Nenhum campo pra alterar.");

    const updated = await prisma.clientService.update({ where: { id: cs.id }, data });

    const action =
      cs.status !== "ENCERRADO" && updated.status === "ENCERRADO" ? "ENCERRADO"
        : cs.status === "ENCERRADO" && updated.status !== "ENCERRADO" ? "REABERTO"
          : "ALTERADO";
    await logFinance({
      companyId: ctx.companyId,
      clientCompanyId: cs.clientCompanyId,
      entity: "CONTRATO",
      entityId: cs.id,
      action,
      description: `${input.motivo?.trim() || "sem motivo informado"} (assistente)`,
      meta: {
        label: updated.label,
        campos: Object.keys(data),
        ...(cs.status !== updated.status && { statusAntes: cs.status, statusDepois: updated.status }),
        ...(cs.amountCents !== updated.amountCents && { valorAntes: cs.amountCents, valorDepois: updated.amountCents }),
        ...(cs.endedAt?.getTime() !== updated.endedAt?.getTime() && {
          fimAntes: cs.endedAt?.toISOString() ?? null, fimDepois: updated.endedAt?.toISOString() ?? null,
        }),
      },
      session: { user: { name: ctx.userName } },
    });
    // Projeto que entrega este contrato herda a vigência (encerrou → arquiva).
    if (data.status !== undefined) await syncProjectStatus(updated.projectId);

    const aviso = updated.endedAt && updated.endedAt > ctx.now && updated.status === "ATIVO"
      ? ` Segue ATIVO e faturando até ${dia(updated.endedAt)}; depois disso sai da fila sozinho.`
      : "";
    return ok(`Serviço de ${cs.clientCompany.name} atualizado.${aviso}\n${linhaServico(updated)}`, {
      data: { id: updated.id, campos: Object.keys(data) },
      link: appUrl(`/empresas/${cs.clientCompanyId}?aba=financeiro`),
    });
  },
};

export const clientesTools: ToolDef[] = [atualizarCliente, listarServicosCliente, atualizarServicoCliente];

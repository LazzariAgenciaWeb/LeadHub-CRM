import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClickupSettings, syncOportunidadeToClickup } from "@/lib/clickup";

const ALLOWED_PIPELINES = ["PROSPECCAO", "LEADS", "OPORTUNIDADES"] as const;
const ALLOWED_STATUS = ["NEW", "CONTACTED", "PROPOSAL", "CLOSED", "LOST"] as const;

/**
 * Espelha no ClickUp o lead que está (ou acabou de entrar) em OPORTUNIDADES —
 * mesma regra do PATCH da tela do lead. Best-effort: falha de integração não
 * derruba o webhook, que já gravou os dados no CRM.
 */
async function syncClickupIfOportunidade(
  companyId: string,
  lead: {
    id: string; name: string | null; phone: string; notes: string | null;
    value: number | null; status: string; pipeline: string | null;
    pipelineStage: string | null; clickupTaskId: string | null;
  },
): Promise<{ synced: boolean; taskId?: string; error?: string } | null> {
  if (lead.pipeline !== "OPORTUNIDADES") return null;
  try {
    const settings = await getClickupSettings(companyId);
    if (!settings?.oportunidadesListId) return null;

    const clickupStatus =
      lead.status === "CLOSED" ? settings.statusGanho :
      lead.status === "LOST"   ? settings.statusPerdido :
      lead.pipelineStage ?? undefined;

    const newTaskId = await syncOportunidadeToClickup({
      settings,
      leadId: lead.id,
      existingClickupTaskId: lead.clickupTaskId ?? null,
      name: lead.name ?? lead.phone,
      notes: lead.notes,
      value: lead.value,
      pipelineStage: clickupStatus,
    });

    if (newTaskId && !lead.clickupTaskId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { clickupTaskId: newTaskId } });
    }
    return { synced: true, taskId: newTaskId ?? lead.clickupTaskId ?? undefined };
  } catch (err: any) {
    return { synced: false, error: err?.message ?? "falha ao sincronizar com ClickUp" };
  }
}

// POST /api/webhook/leads/[token]
// Endpoint público — autenticado pelo token da empresa, sem sessão de usuário.
// Aceita JSON com: name, phone, email, source, pipeline, notes (qualquer combinação).
//
// Dois modos:
//   1. Padrão (sem "update")  → cria o lead. Se já existir com o MESMO telefone
//      no MESMO funil, só completa name/notes/segment/city/instagram e não move
//      de etapa. A rotina de prospecção do Instagram depende desse comportamento.
//   2. "update": true → atualiza o lead existente (casado por leadId ou por
//      telefone em QUALQUER funil) com todos os campos enviados, podendo mover
//      de pipeline/etapa. É o caminho pra promover LEADS → OPORTUNIDADES sem
//      criar duplicata.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const company = await prisma.company.findUnique({
    where: { webhookToken: token },
    select: { id: true, name: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Aceita variações de nome de campo (inglês / português)
  const phone = String(body.phone ?? body.telefone ?? body.cel ?? "").trim().replace(/\D/g, "");
  const name  = String(body.name  ?? body.nome    ?? body.empresa ?? "").trim() || null;
  const email = String(body.email ?? "").trim() || null;
  const source = String(body.source ?? body.origem ?? body.utm_source ?? "webhook").trim();
  const notes  = String(body.notes ?? body.observacoes ?? body.mensagem ?? "").trim() || null;
  const segment = String(body.segment ?? body.segmento ?? body.ramo ?? "").trim() || null;
  const city    = String(body.city ?? body.cidade ?? "").trim() || null;
  // @ do Instagram — chave de identidade para prospecção via Direct (aceita
  // "@fulana", "fulana" ou a URL do perfil). Normalizado em minúsculas.
  const instagram = String(body.instagram ?? body.ig ?? body.username ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "")
    .toLowerCase() || null;

  const rawPipeline = String(body.pipeline ?? "PROSPECCAO").toUpperCase();
  const pipeline = ALLOWED_PIPELINES.includes(rawPipeline as any)
    ? (rawPipeline as (typeof ALLOWED_PIPELINES)[number])
    : "PROSPECCAO";
  // Diferencia "não mandou pipeline" de "mandou PROSPECCAO": no modo update só
  // movemos o lead de funil quando o campo veio explícito no payload.
  const pipelineProvided = body.pipeline != null && String(body.pipeline).trim() !== "";
  const sourceProvided   = body.source != null || body.origem != null || body.utm_source != null;

  // ── Campos extras, usados principalmente no modo update ────────────────────
  const website = String(body.website ?? body.site ?? "").trim() || null;
  const pipelineStage = String(body.pipelineStage ?? body.etapa ?? body.stage ?? "").trim() || null;

  // Valor aceita number ou string em pt-BR ("1.500,50") / en ("1500.50").
  // Vírgula presente ⇒ formato pt-BR (ponto é separador de milhar).
  // Só ponto ⇒ trata como decimal en, senão "1500.50" viraria 150050.
  let value: number | null = null;
  const rawValue = body.value ?? body.valor;
  if (rawValue != null && String(rawValue).trim() !== "") {
    let parsed: number | null = null;
    if (typeof rawValue === "number") {
      parsed = rawValue;
    } else {
      const s = String(rawValue).trim().replace(/[^\d.,-]/g, ""); // tira "R$", espaços
      // Texto sem nenhum dígito vira "" e Number("") é 0 — sem essa guarda,
      // um valor lixo zeraria o valor já gravado no lead.
      if (/\d/.test(s)) {
        parsed = s.includes(",")
          ? Number(s.replace(/\./g, "").replace(",", "."))
          : Number(s);
      }
    }
    if (parsed != null && Number.isFinite(parsed)) value = parsed;
  }

  const rawStatus = String(body.status ?? "").trim().toUpperCase();
  const status = ALLOWED_STATUS.includes(rawStatus as any)
    ? (rawStatus as (typeof ALLOWED_STATUS)[number])
    : null;

  // Modo update: casa o lead existente em QUALQUER funil e aplica todos os
  // campos enviados (inclusive mover de pipeline). Sem a flag, o comportamento
  // antigo é preservado — a rotina de prospecção do Instagram depende disso.
  const updateMode = body.update === true || body.atualizar === true;
  // Só nomes explícitos — "id" genérico ficaria de fora de propósito: muitos
  // formulários mandam um "id" próprio da submissão, e isso viraria 404.
  const leadId = String(body.leadId ?? body.lead_id ?? "").trim() || null;

  if (!phone && !instagram && !leadId) {
    return NextResponse.json(
      { error: "Campo obrigatório: phone (ou telefone), instagram ou leadId" },
      { status: 400 },
    );
  }

  // Sinais de atribuição do Meta (Conversions API). A landing com o Pixel manda
  // os cookies _fbc/_fbp; se vier só o fbclid, montamos o fbc (fb.1.<ms>.<fbclid>).
  // IP e user-agent saem dos headers da requisição (o visitante, não o servidor).
  const fbp = String(body.fbp ?? body._fbp ?? "").trim() || null;
  let fbc = String(body.fbc ?? body._fbc ?? "").trim() || null;
  const fbclid = String(body.fbclid ?? "").trim();
  if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  const eventSourceUrl = String(body.eventSourceUrl ?? body.event_source_url ?? body.url ?? "").trim() || null;
  const clientIp =
    (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "") || null;
  const clientUserAgent = req.headers.get("user-agent") || null;

  // Busca primeira etapa do pipeline da empresa
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: company.id, pipeline },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  // Checa duplicata: por telefone + pipeline (quando tem telefone) ou pelo @
  // do Instagram em QUALQUER pipeline (prospect que já respondeu e virou LEAD
  // não deve ser recriado na PROSPECCAO por um repost da rotina).
  // No modo update a busca por telefone ignora o pipeline — senão o lead que
  // já está em LEADS não seria encontrado ao ser promovido pra OPORTUNIDADES,
  // e o endpoint criaria um duplicado.
  const matchSelect = {
    id: true, pipeline: true, pipelineStage: true, status: true,
    name: true, phone: true, notes: true, value: true, clickupTaskId: true,
  } as const;

  const existing = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, companyId: company.id },
        select: matchSelect,
      })
    : phone
      ? await prisma.lead.findFirst({
          where: { companyId: company.id, phone, ...(updateMode ? {} : { pipeline }) },
          orderBy: { createdAt: "desc" },
          select: matchSelect,
        })
      : await prisma.lead.findFirst({
          where: { companyId: company.id, instagram: { equals: instagram!, mode: "insensitive" } },
          select: matchSelect,
        });

  // leadId informado que não existe (ou é de outra empresa) é erro explícito —
  // criar um lead novo aqui esconderia um bug da integração.
  if (leadId && !existing) {
    return NextResponse.json({ error: "leadId não encontrado nesta empresa" }, { status: 404 });
  }

  if (existing) {
    if (!updateMode) {
      // Reposte da rotina de prospecção: atualiza os dados levantados sem mexer
      // no pipeline/estágio atual do lead.
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(notes ? { notes } : {}),
          ...(segment ? { segment } : {}),
          ...(city ? { city } : {}),
          ...(instagram ? { instagram } : {}),
        },
      });
      return NextResponse.json({
        ok: true,
        updated: true,
        message: "Lead já existia — dados atualizados",
        leadId: existing.id,
      });
    }

    // ── Modo update ─────────────────────────────────────────────────────────
    // Aplica tudo que veio no payload. Campos ausentes ficam como estão.
    const data: Record<string, any> = {
      ...(name      ? { name }      : {}),
      ...(email     ? { email }     : {}),
      ...(notes     ? { notes }     : {}),
      ...(segment   ? { segment }   : {}),
      ...(city      ? { city }      : {}),
      ...(instagram ? { instagram } : {}),
      ...(website   ? { website }   : {}),
      ...(phone     ? { phone }     : {}),
      ...(sourceProvided ? { source } : {}),
      ...(value  != null ? { value }  : {}),
      ...(status != null ? { status } : {}),
    };

    // Move de funil só com pipeline explícito. Sem etapa informada, cai na
    // primeira etapa do funil de destino (mesma regra da criação).
    const movedPipeline = pipelineProvided && pipeline !== existing.pipeline;
    if (movedPipeline) {
      data.pipeline = pipeline;
      data.pipelineStage = pipelineStage ?? firstStage?.name ?? null;
    } else if (pipelineStage) {
      data.pipelineStage = pipelineStage;
    }

    // Carimbo de desfecho — espelha a regra do PATCH da tela do lead.
    if (status === "CLOSED" && existing.status !== "CLOSED") data.wonAt  = new Date();
    if (status === "LOST"   && existing.status !== "LOST")   data.lostAt = new Date();

    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data,
      select: {
        id: true, name: true, phone: true, email: true, value: true, notes: true,
        status: true, pipeline: true, pipelineStage: true, clickupTaskId: true,
      },
    });

    const clickup = await syncClickupIfOportunidade(company.id, lead);

    return NextResponse.json({
      ok: true,
      updated: true,
      movedPipeline,
      message: movedPipeline
        ? `Lead atualizado e movido para ${lead.pipeline}`
        : "Lead atualizado",
      leadId: lead.id,
      lead,
      ...(clickup ? { clickup } : {}),
    });
  }

  const lead = await prisma.lead.create({
    data: {
      phone,
      name,
      email,
      companyId:     company.id,
      source,
      status:        status ?? "NEW",
      pipeline,
      pipelineStage: pipelineStage ?? firstStage?.name ?? null,
      notes,
      instagram,
      segment,
      city,
      website,
      value,
      ...(status === "CLOSED" ? { wonAt:  new Date() } : {}),
      ...(status === "LOST"   ? { lostAt: new Date() } : {}),
      fbc,
      fbp,
      eventSourceUrl,
      clientIp,
      clientUserAgent,
    },
    select: {
      id: true, name: true, phone: true, email: true, instagram: true,
      value: true, notes: true, status: true, pipeline: true,
      pipelineStage: true, clickupTaskId: true,
    },
  });

  const clickup = await syncClickupIfOportunidade(company.id, lead);

  return NextResponse.json(
    { ok: true, created: true, leadId: lead.id, lead, ...(clickup ? { clickup } : {}) },
    { status: 201 },
  );
}

// GET /api/webhook/leads/[token] — verificação de saúde do endpoint
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const company = await prisma.company.findUnique({
    where: { webhookToken: token },
    select: { name: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    company: company.name,
    message: "Webhook ativo. Envie um POST com os dados do lead.",
    fields: {
      required: ["phone OU instagram (ou leadId, no modo update)"],
      optional: [
        "name", "email", "source", "pipeline", "pipelineStage", "notes",
        "segment", "city", "website", "instagram", "value", "status",
        "fbc", "fbp", "fbclid", "eventSourceUrl",
      ],
      pipeline_values: ["PROSPECCAO", "LEADS", "OPORTUNIDADES"],
      status_values: ALLOWED_STATUS,
      meta_capi: "Para melhorar o match no Meta Ads, envie os cookies _fbc e _fbp (ou o fbclid da URL) + eventSourceUrl da landing.",
    },
    update: {
      como: 'Envie "update": true para atualizar um lead que já existe em vez de criar outro.',
      identificacao: "leadId (mais seguro, devolvido na criação) ou phone — no modo update o telefone casa em qualquer funil.",
      move_funil: 'Mande "pipeline" para mover o lead. Sem "pipelineStage", ele cai na primeira etapa do funil de destino.',
      sem_update: "Sem a flag, o comportamento antigo é mantido: casa por telefone no MESMO funil e só atualiza name/notes/segment/city/instagram.",
      clickup: "Lead que fica em OPORTUNIDADES é espelhado no ClickUp automaticamente, se a integração estiver configurada.",
    },
  });
}

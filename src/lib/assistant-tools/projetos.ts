import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { type ToolDef, ok, fail, appUrl, fmtDate, parseDate } from "./types";
import { readComments, sanitizeComments, type TaskComment } from "@/lib/checklist";
import {
  getClickupSettings, updateClickupTask, markClickupTaskDone, reopenClickupTask,
  addCommentToClickupTask, fetchClickupTaskComments, clickupTaskUrl,
} from "@/lib/clickup";
import { CLAUDE_LABEL } from "@/lib/project-ai";
import {
  createEtapa, listEtapas, etapaLabel, ensureEtapaClickupTask, pushTaskToClickup,
} from "@/lib/project-etapas";
import { syncProjectFromClickup } from "@/lib/project-sync";

/**
 * Etapas e tarefas de projeto pelo assistente.
 *
 * Etapa é a tarefa PRINCIPAL do ClickUp (o mês, a fase) e tarefa de etapa é
 * SUBTAREFA dela — então criar etapa aqui cria a tarefa principal lá, e tarefa
 * criada dentro de uma etapa sobe pendurada nela em vez de ficar solta na raiz
 * da lista. Projeto sem lista do ClickUp funciona igual, só sem espelho.
 *
 * Dispara a MESMA sincronização que as telas: título/descrição/prazo/início via
 * update, concluir/reabrir via status, comentário via comment, e troca de etapa
 * trocando a tarefa-mãe da subtarefa.
 */

const STATUSES = ["NOVA", "EM_PRODUCAO", "AGUARDANDO_CLIENTE", "APROVADO"] as const;
const STATUS_LABEL: Record<string, string> = {
  NOVA: "nova", EM_PRODUCAO: "em produção", AGUARDANDO_CLIENTE: "aguardando cliente", APROVADO: "aprovada",
};

/** Projeto da empresa do usuário, ou null. Todo escopo passa por aqui. */
async function loadProject(projetoId: string, companyId: string) {
  return prisma.setorClickupList.findFirst({
    where:  { id: projetoId, setor: { companyId } },
    select: { id: true, name: true, clickupListId: true, setor: { select: { companyId: true } } },
  });
}

/** Tarefa da empresa do usuário, com o que o sync precisa. */
async function loadTask(id: string, companyId: string) {
  return prisma.projectTask.findFirst({
    where: { id, project: { setor: { companyId } } },
    select: {
      id: true, title: true, description: true, status: true, done: true, dueDate: true,
      comments: true, clickupTaskId: true, projectServiceId: true, assigneeId: true, aiAssignedAt: true,
      project: {
        select: { id: true, name: true, clickupListId: true, setor: { select: { companyId: true } } },
      },
      projectService: { select: { id: true, name: true, service: { select: { name: true } } } },
    },
  });
}

function trecho(s: string | null | undefined, n = 200): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function taskLink(projectId: string, taskId: string) {
  return appUrl(`/projetos/${projectId}?tarefa=${taskId}`);
}

/** Autor legível de um comentário do andamento. */
function autorDe(c: TaskComment): string {
  return c.au ?? (c.by === "client" ? "cliente" : "equipe");
}

/** "claude" (ou "ia") no lugar de um id de usuário = despachado pro Claude. */
function isClaude(v: string | undefined | null): boolean {
  return !!v && /^(claude|ia|__claude__)$/i.test(v.trim());
}

export const listarEtapasProjeto: ToolDef<{ projetoId: string }> = {
  name: "listar_etapas_projeto",
  description:
    "Lista as etapas de um projeto na ordem (use listar_projetos pra achar o projetoId). Retorna id, nome, ordem e quantas tarefas abertas e concluídas cada etapa tem. O id daqui é o etapaId usado em criar_tarefa_projeto, listar_tarefas_projeto e atualizar_tarefa_projeto.",
  input_schema: {
    type: "object",
    properties: { projetoId: { type: "string" } },
    required: ["projetoId"],
  },
  run: async ({ projetoId }, ctx) => {
    const project = await loadProject(projetoId, ctx.companyId);
    if (!project) return fail("Projeto não encontrado. Use listar_projetos pra conferir o projetoId.");

    const etapas = await listEtapas(project.id);
    if (etapas.length === 0) {
      return ok(
        `O projeto "${project.name}" ainda não tem etapas. Use criar_etapa_projeto pra criar a primeira (ex.: "Novembro/2026").`,
        { data: [], link: appUrl(`/projetos/${project.id}`) },
      );
    }

    const lines = etapas.map((e, i) =>
      `${String(i + 1).padStart(2, "0")}. ${e.label} · id=${e.id} · ordem ${e.order} · ${e.abertas} aberta(s), ${e.feitas} concluída(s)` +
      (e.clickupTaskId ? "" : " · sem tarefa principal no ClickUp"),
    );
    return ok(
      `Etapas de "${project.name}":\n${lines.join("\n")}`,
      { data: etapas, link: appUrl(`/projetos/${project.id}`) },
    );
  },
};

export const criarEtapaProjeto: ToolDef<{ projetoId: string; nome: string; ordem?: number }> = {
  name: "criar_etapa_projeto",
  description:
    "Cria uma etapa num projeto (use listar_projetos pra achar o projetoId). Etapa é a tarefa PRINCIPAL do mês/fase: quando o projeto tem lista no ClickUp, ela é criada lá e as tarefas da etapa entram como subtarefas dela. ordem opcional (default: última). Idempotente: se já existe etapa com esse nome, devolve a existente sem duplicar.",
  input_schema: {
    type: "object",
    properties: {
      projetoId: { type: "string" },
      nome: { type: "string", description: 'Nome da etapa, ex.: "Novembro/2026"' },
      ordem: { type: "number", description: "Posição na sequência. Omita pra entrar como última." },
    },
    required: ["projetoId", "nome"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const project = await loadProject(input.projetoId, ctx.companyId);
    if (!project) return fail("Projeto não encontrado. Use listar_projetos pra conferir o projetoId.");
    const nome = (input.nome ?? "").trim();
    if (!nome) return fail("Informe o nome da etapa.");

    const { etapa, created } = await createEtapa({
      projectId: project.id,
      name: nome,
      ...(input.ordem !== undefined ? { order: Number(input.ordem) } : {}),
    });

    const espelho = etapa.clickupTaskId
      ? " · tarefa principal criada no ClickUp"
      : project.clickupListId
        ? " · sem espelho no ClickUp (não foi possível criar a tarefa principal agora)"
        : " · projeto só no LeadHub, sem ClickUp";

    return ok(
      created
        ? `Etapa "${etapa.label}" criada no projeto "${project.name}" · id=${etapa.id} · ordem ${etapa.order}${espelho}`
        : `A etapa "${etapa.label}" já existia neste projeto — devolvendo a existente, sem duplicar · id=${etapa.id} · ordem ${etapa.order}`,
      { data: { id: etapa.id, label: etapa.label, order: etapa.order, clickupTaskId: etapa.clickupTaskId, created },
        link: appUrl(`/projetos/${project.id}`) },
    );
  },
};

export const listarTarefasProjeto: ToolDef<{
  projetoId?: string; assigneeId?: string; etapaId?: string; status?: string; query?: string; venceAte?: string;
}> = {
  name: "listar_tarefas_projeto",
  description:
    "Lista tarefas de projeto. Com projetoId: as tarefas daquele projeto. Sem projetoId: em todos os projetos da empresa, filtrando por responsável — assigneeId='claude' traz as tarefas DESPACHADAS PRO CLAUDE (IA) pra ele executar; ou um id de listar_usuarios. Informe ao menos projetoId, assigneeId ou query. Outros filtros: etapa (etapaId), status (abertas | concluidas | todas — default abertas), trecho do título (query), prazo máximo (venceAte, ISO 8601). Retorna id, título, cliente, projeto, etapa, status, responsável, prazo, link da tarefa no GoHub, link do ClickUp, começo da descrição e os 3 últimos comentários (com autor e data — o pedido do Diego costuma vir num comentário; use listar_comentarios_tarefa_projeto pra ver todos).",
  input_schema: {
    type: "object",
    properties: {
      projetoId: { type: "string", description: "Opcional se assigneeId ou query vier" },
      assigneeId: { type: "string", description: "'claude' = tarefas despachadas pro Claude (IA); ou id de usuário (listar_usuarios)" },
      etapaId: { type: "string", description: "Só as tarefas desta etapa (de listar_etapas_projeto)" },
      status: { type: "string", enum: ["abertas", "concluidas", "todas"] },
      query: { type: "string", description: "Trecho do título" },
      venceAte: { type: "string", description: "Só tarefas com prazo até esta data (ISO 8601)" },
    },
  },
  run: async (input, ctx) => {
    if (!input.projetoId && !input.assigneeId && !input.query) {
      return fail("Informe projetoId, assigneeId (ex.: 'claude') ou query.");
    }
    const project = input.projetoId ? await loadProject(input.projetoId, ctx.companyId) : null;
    if (input.projetoId && !project) return fail("Projeto não encontrado. Use listar_projetos pra conferir o projetoId.");

    if (input.etapaId) {
      const etapa = await prisma.projectService.findUnique({
        where: { id: input.etapaId }, select: { projectId: true },
      });
      if (!etapa || (project && etapa.projectId !== project.id)) {
        return fail(`A etapa ${input.etapaId} não pertence a esse projeto. Use listar_etapas_projeto pra pegar o etapaId certo.`);
      }
    }

    const venceAte = input.venceAte ? parseDate(input.venceAte) : null;
    if (input.venceAte && !venceAte) return fail("venceAte inválido — use ISO 8601 (ex.: 2026-11-30T23:59:00-03:00).");

    const paraClaude = isClaude(input.assigneeId);
    const status = input.status ?? "abertas";
    const rows = await prisma.projectTask.findMany({
      where: {
        ...(project ? { projectId: project.id } : { project: { setor: { companyId: ctx.companyId } } }),
        ignoredAt: null,
        ...(paraClaude ? { aiAssignedAt: { not: null } } : input.assigneeId ? { assigneeId: input.assigneeId, aiAssignedAt: null } : {}),
        ...(input.etapaId ? { projectServiceId: input.etapaId } : {}),
        ...(status === "abertas" ? { done: false } : status === "concluidas" ? { done: true } : {}),
        ...(input.query ? { title: { contains: input.query, mode: "insensitive" } } : {}),
        ...(venceAte ? { dueDate: { lte: venceAte } } : {}),
      },
      select: {
        id: true, title: true, description: true, status: true, done: true, dueDate: true,
        clickupTaskId: true, aiAssignedAt: true, comments: true,
        assignee: { select: { name: true } },
        project: { select: { id: true, name: true, clientCompany: { select: { id: true, name: true } } } },
        projectService: { select: { id: true, name: true, service: { select: { name: true } } } },
      },
      orderBy: [{ done: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      take: 60,
    });

    const onde = project ? `em "${project.name}"` : paraClaude ? "despachada(s) pro Claude" : "nos projetos";
    if (rows.length === 0) {
      return ok(
        `Nenhuma tarefa ${status === "todas" ? "" : status + " "}${onde}${input.etapaId ? " nessa etapa" : ""}.`,
        { data: [], ...(project ? { link: appUrl(`/projetos/${project.id}`) } : {}) },
      );
    }

    const data = rows.map((t) => {
      const comentarios = readComments(t.comments).slice(-3).map((c) => ({ autor: autorDe(c), data: c.at, texto: trecho(c.text, 400) }));
      return {
        id: t.id, titulo: t.title,
        cliente: t.project.clientCompany?.name ?? null, clienteId: t.project.clientCompany?.id ?? null,
        projeto: t.project.name, projetoId: t.project.id,
        etapa: t.projectService ? etapaLabel(t.projectService) : null, etapaId: t.projectService?.id ?? null,
        status: t.status, concluida: t.done, prazo: t.dueDate,
        responsavel: t.aiAssignedAt ? CLAUDE_LABEL : (t.assignee?.name ?? null),
        dono: t.assignee?.name ?? null, comClaudeDesde: t.aiAssignedAt,
        link: taskLink(t.project.id, t.id),
        clickupTaskId: t.clickupTaskId, clickupUrl: t.clickupTaskId ? clickupTaskUrl(t.clickupTaskId) : null,
        descricao: trecho(t.description, 300) || null,
        ultimosComentarios: comentarios,
      };
    });

    const lines = data.map((t) =>
      `- ${t.titulo} · id=${t.id}` +
      `\n    ${t.cliente ?? "sem cliente"} › ${t.projeto} › ${t.etapa ?? "sem etapa"} · ${STATUS_LABEL[t.status] ?? t.status}` +
      ` · ${t.responsavel ?? "sem responsável"}${t.comClaudeDesde ? ` (dono: ${t.dono ?? "—"})` : ""} · prazo ${fmtDate(t.prazo)}` +
      `\n    ${t.link}${t.clickupUrl ? ` · ClickUp ${t.clickupUrl}` : " · só no GoHub"}` +
      (t.descricao ? `\n    ${t.descricao}` : "") +
      t.ultimosComentarios.map((c) => `\n    💬 ${c.autor} ${fmtDate(new Date(c.data))}: ${c.texto}`).join(""),
    );
    return ok(
      `${rows.length} tarefa(s) ${onde}:\n${lines.join("\n")}`,
      { data, ...(project ? { link: appUrl(`/projetos/${project.id}`) } : {}) },
    );
  },
};

export const listarComentariosTarefaProjeto: ToolDef<{ id: string }> = {
  name: "listar_comentarios_tarefa_projeto",
  description:
    "Todos os comentários/andamentos de uma tarefa de projeto (id de listar_tarefas_projeto), em ordem cronológica, com autor e data. Junta o andamento do GoHub com os comentários do ClickUp (lidos agora, se a tarefa está lá). É onde vem o pedido do Diego quando ele despacha a tarefa pro Claude.",
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  run: async ({ id }, ctx) => {
    const task = await loadTask(id, ctx.companyId);
    if (!task) return fail("Tarefa não encontrada. Use listar_tarefas_projeto pra pegar o id.");

    type Linha = { autor: string; data: string; texto: string; origem: "GoHub" | "ClickUp"; cid?: string };
    const local: Linha[] = readComments(task.comments).map((c) => ({ autor: autorDe(c), data: c.at, texto: c.text, origem: "GoHub", cid: c.cid }));
    let remoto: Linha[] = [];
    if (task.clickupTaskId) {
      const settings = await getClickupSettings(task.project.setor.companyId).catch(() => null);
      if (settings?.apiToken) {
        const vistos = new Set(local.map((c) => c.cid).filter(Boolean));
        const textos = new Set(local.map((c) => c.texto.trim()));
        const cu = await fetchClickupTaskComments(settings.apiToken, task.clickupTaskId);
        remoto = cu
          .filter((c) => !(c.cid && vistos.has(c.cid)) && !textos.has(c.text.trim()))
          .map((c) => ({ autor: c.au ?? "ClickUp", data: c.at, texto: c.text, origem: "ClickUp" as const, cid: c.cid }));
        // O GoHub guarda o autor que o ClickUp informa — preenche os antigos que vieram sem.
        const autorPorCid = new Map(cu.filter((c) => c.cid && c.au).map((c) => [c.cid!, c.au!]));
        for (const l of local) if (l.autor === "equipe" && l.cid && autorPorCid.has(l.cid)) l.autor = autorPorCid.get(l.cid)!;
      }
    }
    const todos = [...local, ...remoto].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
    if (!todos.length) return ok(`"${task.title}" ainda não tem comentários.`, { data: [], link: taskLink(task.project.id, task.id) });
    return ok(
      `${todos.length} comentário(s) em "${task.title}":\n` +
      todos.map((c) => `- ${fmtDate(new Date(c.data))} · ${c.autor}${c.origem === "ClickUp" ? " (ClickUp)" : ""}: ${c.texto}`).join("\n"),
      { data: todos.map(({ cid, ...c }) => c), link: taskLink(task.project.id, task.id) },
    );
  },
};

export const atualizarTarefaProjeto: ToolDef<{
  id: string; status?: string; dueDate?: string | null; assigneeId?: string;
  etapaId?: string; title?: string; description?: string;
}> = {
  name: "atualizar_tarefa_projeto",
  description:
    "Atualiza uma tarefa de projeto (id de listar_tarefas_projeto). Só mexe nos campos enviados. status: NOVA, EM_PRODUCAO, AGUARDANDO_CLIENTE ou APROVADO (APROVADO conclui; qualquer outro reabre). dueDate em ISO 8601 com fuso -03:00, null remove o prazo. etapaId move de etapa (de listar_etapas_projeto) — no ClickUp a tarefa passa a ser subtarefa da tarefa principal dessa etapa. assigneeId='claude' despacha pro Claude (IA); um id de usuário (listar_usuarios) devolve pra essa pessoa e tira do Claude — ao terminar, devolva pro dono (campo dono de listar_tarefas_projeto). No ClickUp refletem: título, descrição, prazo, etapa, concluir (APROVADO) e reabrir. NÃO refletem: responsável (o Claude só existe no GoHub) e os status intermediários (NOVA/EM_PRODUCAO/AGUARDANDO_CLIENTE) — só concluir/reabrir mudam o status lá.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: [...STATUSES] },
      dueDate: { type: ["string", "null"], description: "ISO 8601 com fuso -03:00. null remove o prazo." },
      assigneeId: { type: "string", description: "'claude' = despacha pro Claude (IA); id de usuário (listar_usuarios) = devolve pra ele" },
      etapaId: { type: "string", description: "Etapa de destino (de listar_etapas_projeto)" },
      title: { type: "string" },
      description: { type: "string" },
    },
    required: ["id"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const task = await loadTask(input.id, ctx.companyId);
    if (!task) return fail("Tarefa não encontrada. Use listar_tarefas_projeto pra pegar o id.");

    const data: Prisma.ProjectTaskUpdateInput = {};
    const mudou: string[] = [];

    if (input.title !== undefined) {
      const t = input.title.trim();
      if (!t) return fail("title não pode ficar vazio.");
      data.title = t; mudou.push(`título → "${t}"`);
    }
    if (input.description !== undefined) {
      data.description = input.description.trim() || null;
      mudou.push("descrição atualizada");
    }
    if (input.dueDate !== undefined) {
      if (input.dueDate === null) { data.dueDate = null; mudou.push("prazo removido"); }
      else {
        const d = parseDate(input.dueDate);
        if (!d) return fail("dueDate inválido — use ISO 8601 (ex.: 2026-11-30T18:00:00-03:00) ou null pra remover.");
        data.dueDate = d; mudou.push(`prazo → ${fmtDate(d)}`);
      }
    }
    if (isClaude(input.assigneeId)) {
      if (!task.aiAssignedAt) data.aiAssignedAt = new Date();
      if (!task.assigneeId) data.assignee = { connect: { id: ctx.userId } };
      mudou.push(`responsável → ${CLAUDE_LABEL}`);
    } else if (input.assigneeId !== undefined) {
      const u = await prisma.user.findFirst({
        where: { id: input.assigneeId, companyId: ctx.companyId }, select: { id: true, name: true },
      });
      if (!u) return fail("assigneeId não é um usuário da sua empresa. Use listar_usuarios.");
      data.assignee = { connect: { id: u.id } }; data.aiAssignedAt = null;
      mudou.push(`responsável → ${u.name}${task.aiAssignedAt ? " (saiu do Claude)" : ""}`);
    }
    if (input.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(input.status)) {
        return fail(`status inválido. Use um de: ${STATUSES.join(", ")}.`);
      }
      // status é a fonte única: done/completedAt/awaitingClient derivam dele.
      data.status         = input.status;
      data.done           = input.status === "APROVADO";
      data.completedAt    = input.status === "APROVADO" ? new Date() : null;
      data.awaitingClient = input.status === "AGUARDANDO_CLIENTE";
      mudou.push(`status → ${STATUS_LABEL[input.status]}`);
    }

    let novaEtapa: { id: string; label: string; clickupTaskId: string | null } | null = null;
    if (input.etapaId !== undefined) {
      const etapa = await prisma.projectService.findUnique({
        where:  { id: input.etapaId },
        select: { id: true, projectId: true, name: true, clickupTaskId: true, service: { select: { name: true } } },
      });
      if (!etapa || etapa.projectId !== task.project.id) {
        return fail(`A etapa ${input.etapaId} não pertence ao projeto "${task.project.name}". Use listar_etapas_projeto pra pegar o etapaId certo.`);
      }
      const label = etapaLabel(etapa);
      data.projectService = { connect: { id: etapa.id } };
      data.stage = label.slice(0, 80) || null;
      novaEtapa = { id: etapa.id, label, clickupTaskId: etapa.clickupTaskId };
      mudou.push(`etapa → ${label}`);
    }

    if (mudou.length === 0) return fail("Nada pra atualizar — envie ao menos um campo.");

    await prisma.projectTask.update({ where: { id: task.id }, data });

    // Histórico da tarefa, igual a tela grava.
    const eventos: { projectId: string; taskId: string; type: string; fromText?: string | null; toText?: string | null }[] = [];
    if (input.status !== undefined && input.status !== task.status) {
      eventos.push({ projectId: task.project.id, taskId: task.id, type: "STATUS", fromText: task.status, toText: input.status });
    }
    if (input.assigneeId !== undefined) {
      const para = isClaude(input.assigneeId) ? "Claude (IA)" : mudou.find((m) => m.startsWith("responsável"))?.replace(/^responsável → /, "") ?? null;
      eventos.push({ projectId: task.project.id, taskId: task.id, type: "ASSIGNEE", fromText: task.aiAssignedAt ? "Claude (IA)" : null, toText: para });
    }
    if (input.dueDate !== undefined) {
      eventos.push({
        projectId: task.project.id, taskId: task.id, type: "DUE",
        fromText: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
        toText: data.dueDate instanceof Date ? data.dueDate.toISOString().slice(0, 10) : null,
      });
    }
    if (eventos.length) {
      await prisma.projectTaskEvent.createMany({
        data: eventos.map((e) => ({ ...e, authorId: ctx.userId, authorName: ctx.userName })),
      }).catch(() => {});
    }

    // ── ClickUp: a mesma sincronização das telas ────────────────────────────
    const avisos: string[] = [];
    let clickupTaskId = task.clickupTaskId;

    // Entrou numa etapa e ainda não estava no ClickUp: sobe agora, já como
    // subtarefa da tarefa principal da etapa.
    if (!clickupTaskId && novaEtapa && task.project.clickupListId) {
      const parent = novaEtapa.clickupTaskId ?? await ensureEtapaClickupTask(novaEtapa.id).catch(() => null);
      if (parent) {
        const r = await pushTaskToClickup(task.id).catch(() => null);
        if (r?.ok) { clickupTaskId = r.clickupTaskId; avisos.push("subiu pro ClickUp como subtarefa da etapa"); }
      }
    }

    if (clickupTaskId) {
      try {
        const settings = await getClickupSettings(task.project.setor.companyId);
        if (settings?.apiToken) {
          const parent = novaEtapa
            ? (novaEtapa.clickupTaskId ?? await ensureEtapaClickupTask(novaEtapa.id).catch(() => null))
            : null;
          const syncFields = input.title !== undefined || input.description !== undefined || input.dueDate !== undefined;
          if (syncFields || parent) {
            await updateClickupTask({
              apiToken:    settings.apiToken,
              taskId:      clickupTaskId,
              ...(parent ? { parent } : {}),
              name:        input.title !== undefined ? input.title.trim() : undefined,
              description: input.description !== undefined ? (input.description.trim() || "") : undefined,
              dueDate:     input.dueDate !== undefined ? (data.dueDate instanceof Date ? data.dueDate.getTime() : null) : undefined,
            });
            if (parent) avisos.push("tarefa-mãe trocada no ClickUp");
          }
          if (input.assigneeId !== undefined) avisos.push("responsável não vai pro ClickUp");
          if (input.status !== undefined && input.status !== "APROVADO" && !task.done) avisos.push("status intermediário não muda no ClickUp");
          if (input.status === "APROVADO" && !task.done) {
            await markClickupTaskDone(settings.apiToken, clickupTaskId, settings.statusChamadoConcluido);
            avisos.push("fechada no ClickUp");
          } else if (input.status !== undefined && input.status !== "APROVADO" && task.done) {
            await reopenClickupTask(settings.apiToken, clickupTaskId);
            avisos.push("reaberta no ClickUp");
          }
        }
      } catch (e) { console.error("[assistente] clickup sync tarefa projeto:", e); }
    }

    return ok(
      `Tarefa "${input.title?.trim() ?? task.title}" atualizada: ${mudou.join(", ")}.` +
      (avisos.length ? ` (${avisos.join("; ")})` : ""),
      { data: { id: task.id, clickupTaskId }, link: taskLink(task.project.id, task.id) },
    );
  },
};

export const comentarTarefaProjeto: ToolDef<{ id: string; texto: string }> = {
  name: "comentar_tarefa_projeto",
  description:
    "Adiciona um andamento/comentário datado numa tarefa de projeto (id de listar_tarefas_projeto), sem sobrescrever a descrição. Use pra registrar aprovação lida no WhatsApp (data, quem falou e um trecho da mensagem). Se a tarefa está no ClickUp, o comentário vai pra lá também.",
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      texto: { type: "string" },
    },
    required: ["id", "texto"],
  },
  mutating: true,
  run: async (input, ctx) => {
    const task = await loadTask(input.id, ctx.companyId);
    if (!task) return fail("Tarefa não encontrada. Use listar_tarefas_projeto pra pegar o id.");
    const texto = (input.texto ?? "").trim();
    if (!texto) return fail("Informe o texto do comentário.");

    let cid: string | null = null;
    if (task.clickupTaskId) {
      try {
        const settings = await getClickupSettings(task.project.setor.companyId);
        if (settings?.apiToken) {
          cid = await addCommentToClickupTask({
            apiToken: settings.apiToken, taskId: task.clickupTaskId,
            comment: ctx.channel === "MCP" ? `🤖 Claude (IA): ${texto}` : texto,
          });
        }
      } catch (e) { console.error("[assistente] clickup comentario tarefa:", e); }
    }

    // Pelo MCP quem escreve é o Claude, não o dono do token.
    const c: TaskComment = { text: texto, at: new Date().toISOString(), au: ctx.channel === "MCP" ? "Claude (IA)" : ctx.userName };
    if (cid) c.cid = cid;
    const next = [...readComments(task.comments), c];
    await prisma.projectTask.update({
      where: { id: task.id },
      data:  { comments: sanitizeComments(next) ?? Prisma.DbNull },
    });

    // A tela não grava evento de comentário; aqui grava, porque a aprovação que
    // chega pelo WhatsApp precisa aparecer na linha do tempo da tarefa.
    await prisma.projectTaskEvent.create({
      data: {
        projectId: task.project.id, taskId: task.id, type: "COMMENT",
        toText: texto.slice(0, 500), authorId: ctx.userId, authorName: ctx.userName,
      },
    }).catch(() => {});

    return ok(
      `Andamento registrado em "${task.title}"${cid ? " (também no ClickUp)" : ""}.`,
      { data: { id: task.id }, link: appUrl(`/projetos/${task.project.id}`) },
    );
  },
};

export const sincronizarProjeto: ToolDef<{ projetoId: string }> = {
  name: "sincronizar_projeto",
  description:
    "Puxa a lista do ClickUp pra dentro do projeto AGORA — o mesmo que apertar 'Atualizar' na tela do projeto. Traz tarefa nova do ClickUp pra caixa de entrada do projeto, atualiza título/prazo/conclusão das que já existem e refaz o vínculo entre tarefa principal (etapa) e subtarefas. Use ANTES de listar tarefas quando precisar do que está no ClickUp agora, e DEPOIS de mexer lá fora. Projeto sem lista do ClickUp não tem o que sincronizar e a ferramenta avisa. Use listar_projetos pra pegar o projetoId.",
  mutating: true,
  input_schema: {
    type: "object",
    properties: {
      projetoId: { type: "string", description: "Id do projeto (listar_projetos)." },
    },
    required: ["projetoId"],
  },
  run: async (input, ctx) => {
    const project = await loadProject(input.projetoId, ctx.companyId);
    if (!project) return fail(`Projeto ${input.projetoId} não encontrado nesta empresa. Use listar_projetos pra pegar o projetoId certo.`);

    const r = await syncProjectFromClickup(project.id);
    if (!r.ok) return fail(r.reason);

    // O que a skill quer saber depois de sincronizar: quanto sobrou sem etapa.
    const aOrganizar = await prisma.projectTask.count({
      where: { projectId: project.id, clickupTaskId: { not: null }, projectServiceId: null, ignoredAt: null },
    });

    const partes = [
      `${r.tasksFound} tarefa(s) na lista do ClickUp`,
      r.mirrored > 0 ? `${r.mirrored} nova(s) trazida(s) agora` : "nenhuma nova",
      `${r.atualizadas} atualizada(s)`,
    ];
    if (r.activities.completed > 0) partes.push(`${r.activities.completed} concluída(s) desde a última sync`);
    partes.push(
      aOrganizar > 0
        ? `${aOrganizar} ainda sem etapa (a organizar)`
        : "nenhuma pendente de etapa",
    );

    return ok(
      `Projeto "${r.projectName}" sincronizado: ${partes.join(" · ")}.`,
      { data: r, link: appUrl(`/projetos/${project.id}`) },
    );
  },
};


export const projetosTools: ToolDef[] = [
  listarEtapasProjeto,
  criarEtapaProjeto,
  listarTarefasProjeto,
  listarComentariosTarefaProjeto,
  atualizarTarefaProjeto,
  comentarTarefaProjeto,
  sincronizarProjeto,
];

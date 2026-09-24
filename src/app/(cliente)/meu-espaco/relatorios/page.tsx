import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const fmtD = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

const STATUS_LABEL: Record<string, string> = {
  NOVA: "Nova", EM_PRODUCAO: "Em produção",
  AGUARDANDO_CLIENTE: "Aguardando você", APROVADO: "Aprovado",
};

/** "2026-09" → janela [início do mês, início do mês seguinte). */
function janela(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return { de: new Date(a, m - 1, 1), ate: new Date(a, m, 1), ano: a, mesIdx: m - 1 };
}

/** Últimos 12 meses como opções do seletor. */
function mesesDisponiveis(): { valor: string; rotulo: string }[] {
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { valor, rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}` };
  });
}

export default async function RelatoriosPage({
  searchParams,
}: { searchParams: Promise<{ mes?: string; projeto?: string }> }) {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const opcoes = mesesDisponiveis();
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : opcoes[0].valor;
  const { de, ate, ano, mesIdx } = janela(mes);

  // Projetos do cliente. O relatório é por projeto — sem projeto, não há o que mostrar.
  const projetos = await prisma.setorClickupList.findMany({
    where:   { clientCompanyId: companyId, status: { not: "CANCELADO" } },
    orderBy: [{ createdAt: "desc" }],
    select:  { id: true, name: true },
  });
  if (projetos.length === 0) {
    return (
      <div className="wrap">
        <h1>Relatórios</h1>
        <p className="vazio">Nenhum projeto ativo por aqui ainda.</p>
        <Estilo />
      </div>
    );
  }
  const projetoId = sp.projeto && projetos.some((p) => p.id === sp.projeto) ? sp.projeto! : projetos[0].id;
  const projeto = projetos.find((p) => p.id === projetoId)!;

  // Eventos do mês + tarefas visíveis ao cliente. Tarefa interna nunca aparece.
  const [eventos, tarefas] = await Promise.all([
    prisma.projectTaskEvent.findMany({
      where:   { projectId: projetoId, createdAt: { gte: de, lt: ate } },
      orderBy: { createdAt: "asc" },
      select:  { type: true, fromText: true, toText: true, byClient: true, createdAt: true, taskId: true },
    }),
    prisma.projectTask.findMany({
      where:   { projectId: projetoId, visibleToClient: true, ignoredAt: null },
      select:  { id: true, title: true, status: true, done: true, createdAt: true, completedAt: true, dueDate: true },
    }),
  ]);
  const porId = new Map(tarefas.map((t) => [t.id, t]));
  const visivel = (taskId: string) => porId.has(taskId);

  // ── Entregue no mês: quem foi pra APROVADO dentro da janela ──────────────
  const entreguesIds = new Set(
    eventos.filter((e) => e.type === "STATUS" && e.toText === "APROVADO" && visivel(e.taskId)).map((e) => e.taskId),
  );
  const entregues = [...entreguesIds].map((id) => porId.get(id)!).filter(Boolean);

  // Tempo de entrega: da abertura até a conclusão, em dias.
  const dias = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
  const tempos = entregues.filter((t) => t.completedAt).map((t) => dias(t.createdAt, t.completedAt!));
  const tempoMedio = tempos.length ? Math.round(tempos.reduce((s, n) => s + n, 0) / tempos.length) : null;

  // Em aberto HOJE (foto do momento, não do mês).
  const abertas = tarefas.filter((t) => !t.done);
  const aguardandoVoce = abertas.filter((t) => t.status === "AGUARDANDO_CLIENTE");

  // Pedidas no mês e interações do cliente.
  const abertasNoMes = tarefas.filter((t) => t.createdAt >= de && t.createdAt < ate);
  const interacoes = eventos.filter((e) => e.byClient && e.type === "COMMENT" && visivel(e.taskId));
  const rodadas = eventos.filter(
    (e) => e.type === "STATUS" && e.fromText === "AGUARDANDO_CLIENTE" && e.toText === "EM_PRODUCAO" && visivel(e.taskId),
  );

  const semDados = entregues.length === 0 && abertasNoMes.length === 0 && interacoes.length === 0;

  return (
    <div className="wrap">
      <div className="head">
        <div>
          <h1>Relatório mensal</h1>
          <p className="sub">O que andou no seu projeto em {MESES[mesIdx]} de {ano}.</p>
        </div>
      </div>

      <form className="filtros">
        {projetos.length > 1 && (
          <select name="projeto" defaultValue={projetoId}>
            {projetos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select name="mes" defaultValue={mes}>
          {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
        <button type="submit">Ver</button>
      </form>

      {semDados ? (
        <p className="vazio">Nada registrado neste mês em <strong>{projeto.name}</strong>.</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><b>{entregues.length}</b><span>entregue{entregues.length === 1 ? "" : "s"} no mês</span></div>
            <div className="kpi"><b>{abertasNoMes.length}</b><span>pedida{abertasNoMes.length === 1 ? "" : "s"} no mês</span></div>
            <div className="kpi"><b>{tempoMedio === null ? "—" : `${tempoMedio}d`}</b><span>tempo médio de entrega</span></div>
            <div className="kpi"><b>{interacoes.length}</b><span>retorno{interacoes.length === 1 ? "" : "s"} seu{interacoes.length === 1 ? "" : "s"}</span></div>
          </div>

          {rodadas.length > 0 && (
            <p className="nota">
              {rodadas.length} {rodadas.length === 1 ? "vez a tarefa voltou" : "vezes as tarefas voltaram"} pra ajuste depois do seu retorno.
            </p>
          )}

          <section>
            <h2>✅ Entregue neste mês</h2>
            {entregues.length === 0 ? <p className="vazio">Nada concluído neste mês.</p> : (
              <ul className="lista">
                {entregues.map((t) => (
                  <li key={t.id}>
                    <span className="tit">{t.title}</span>
                    <span className="meta">
                      pedido {fmtD(t.createdAt)}
                      {t.completedAt && <> · entregue {fmtD(t.completedAt)} · {dias(t.createdAt, t.completedAt)}d</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>🔄 Em andamento agora</h2>
            {abertas.length === 0 ? <p className="vazio">Nada em aberto — tudo entregue.</p> : (
              <ul className="lista">
                {abertas.map((t) => (
                  <li key={t.id}>
                    <span className="tit">{t.title}</span>
                    <span className="meta">
                      {STATUS_LABEL[t.status] ?? t.status}
                      {t.dueDate && <> · previsto {fmtD(t.dueDate)}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {aguardandoVoce.length > 0 && (
            <section className="alerta">
              <h2>⏳ Esperando você</h2>
              <ul className="lista">
                {aguardandoVoce.map((t) => <li key={t.id}><span className="tit">{t.title}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
      <Estilo />
    </div>
  );
}

function Estilo() {
  return (
    <style>{`
      .wrap { padding: 24px; max-width: 900px; margin: 0 auto; }
      .wrap h1 { font-size: 22px; font-weight: 600; margin: 0; }
      .sub { color: #8a93a6; font-size: 13px; margin: 4px 0 0; }
      .head { margin-bottom: 18px; }
      .filtros { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
      .filtros select, .filtros button {
        background: #0f1729; border: 1px solid #1e2d45; color: #e6ebf5;
        border-radius: 8px; padding: 7px 10px; font-size: 13px;
      }
      .filtros button { background: #4f46e5; border-color: #4f46e5; cursor: pointer; font-weight: 500; }
      .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .kpi { background: #0f1729; border: 1px solid #1e2d45; border-radius: 12px; padding: 14px; }
      .kpi b { display: block; font-size: 24px; font-weight: 600; color: #fff; line-height: 1; }
      .kpi span { display: block; font-size: 11px; color: #8a93a6; margin-top: 6px; }
      .nota { font-size: 12px; color: #8a93a6; margin: 0 0 18px; }
      section { margin-bottom: 22px; }
      section h2 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #e6ebf5; }
      .lista { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .lista li { background: #0f1729; border: 1px solid #1e2d45; border-radius: 10px; padding: 10px 12px; }
      .tit { display: block; font-size: 13px; color: #e6ebf5; }
      .meta { display: block; font-size: 11px; color: #8a93a6; margin-top: 3px; }
      .alerta .lista li { border-color: rgba(245,158,11,.4); background: rgba(245,158,11,.07); }
      .vazio { color: #6b7385; font-size: 13px; }
      @media (max-width: 640px) { .wrap { padding: 16px; } }
    `}</style>
  );
}

import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import MeuEspacoInteracoes from "./MeuEspacoInteracoes";
import ProjetosServicos from "./ProjetosServicos";
import { clientComments } from "@/lib/checklist";
import { hasModule } from "@/lib/permissions";
import { visibleCategoriesWhere } from "@/lib/videos";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: string }> = {
  PLANEJAMENTO:       { label: "Planejamento",   tone: "info" },
  EM_ANDAMENTO:       { label: "Em andamento",   tone: "info" },
  AGUARDANDO_CLIENTE: { label: "Aguardando você", tone: "warn" },
  PAUSADO:            { label: "Pausado",        tone: "muted" },
  ENTREGUE:           { label: "Concluído",      tone: "ok" },
};
// Capas em degradê, rotacionadas por posição (estilo pôster).
const COVERS = [
  "linear-gradient(135deg,#8B5CF6,#EC4899)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
  "linear-gradient(135deg,#3D5AF1,#6366F1)",
  "linear-gradient(135deg,#F59E0B,#F97316)",
  "linear-gradient(135deg,#10B981,#0D9488)",
];
const fmtDM = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (d: Date) => d.toLocaleDateString("pt-BR");

export default async function MeuEspacoPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  const userName = ((session?.user as any)?.name as string | undefined)?.split(" ")[0] ?? null;

  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, parentCompanyId: true },
  });
  if (!company?.parentCompanyId) redirect("/dashboard");

  // Central de vídeos: só destaca o card quando o módulo está ligado E há
  // vídeo liberado pra este cliente (evita mandar pra uma tela vazia).
  const showVideos = hasModule(session, "videos");
  const videoCount = showVideos
    ? await prisma.video.count({
        where: { active: true, category: visibleCategoriesWhere(companyId, company.parentCompanyId) },
      })
    : 0;

  const projects = await prisma.setorClickupList.findMany({
    where:   { clientCompanyId: companyId, status: { not: "CANCELADO" } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, name: true, description: true, status: true,
      service: { select: { name: true } },
      internalTasks: {
        where: { visibleToClient: true },
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, title: true, description: true, comments: true, done: true, startDate: true, dueDate: true, projectServiceId: true, awaitingClient: true },
      },
      serviceSteps: {
        where: { visibleToClient: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, order: true, service: { select: { name: true } } },
      },
    },
  });

  // Chamados/pedidos + catálogo visível pro cliente + serviços contratados dele.
  const [ticketsRaw, servicesRaw, contractedRaw, invoicesRaw, ticketStatsRaw] = await Promise.all([
    prisma.ticket.findMany({
      where:   { clientCompanyId: companyId },
      orderBy: [{ createdAt: "desc" }],
      take:    12,
      select:  { id: true, title: true, category: true, status: true, createdAt: true },
    }),
    prisma.service.findMany({
      where:   { companyId: company.parentCompanyId, showInClientArea: true },
      orderBy: [{ order: "asc" }],
      take:    12,
      select:  { id: true, name: true, description: true },
    }),
    prisma.clientService.findMany({
      where:   { clientCompanyId: companyId, status: { not: "ENCERRADO" } },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      select:  { id: true, label: true, status: true, renewsAt: true, url: true, service: { select: { name: true } } },
    }),
    prisma.clientInvoice.findMany({
      where:   { clientCompanyId: companyId, status: { not: "CANCELADO" } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take:    24,
      select:  { id: true, description: true, amountCents: true, dueDate: true, status: true, paidAt: true, boletoUrl: true, invoiceUrl: true },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { clientCompanyId: companyId, isInternal: false },
      _count: { _all: true },
    }),
  ]);
  const tickets = ticketsRaw.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
  const byStatus: Record<string, number> = Object.fromEntries(ticketStatsRaw.map((g) => [g.status, g._count._all]));
  const ticketStats = {
    open:       byStatus.OPEN ?? 0,
    inProgress: byStatus.IN_PROGRESS ?? 0,
    resolved:   (byStatus.RESOLVED ?? 0) + (byStatus.CLOSED ?? 0),
    total:      Object.values(byStatus).reduce((a, b) => a + b, 0),
  };

  const now = new Date();
  const cards = projects.map((p, i) => {
    const total = p.internalTasks.length;
    const done = p.internalTasks.filter((t) => t.done).length;
    const overdue = p.internalTasks.filter((t) => !t.done && t.dueDate && new Date(t.dueDate) < now).length;
    const awaiting = p.internalTasks.filter((t) => t.awaitingClient).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const nextDue = p.internalTasks
      .filter((t) => !t.done && t.dueDate && new Date(t.dueDate) >= now)
      .map((t) => new Date(t.dueDate as Date))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { ...p, total, done, overdue, awaiting, pct, nextDue, cover: COVERS[i % COVERS.length] };
  });

  // Estrutura projeto → serviço → tarefas visíveis (pra seção "Serviços em execução").
  const PROJECT_TINT = ["#8B6DFF", "#4B9BFF", "#2DD4BF", "#F59E0B", "#EC4899"];
  const projectsData = projects
    .map((p, i) => {
      const services = p.serviceSteps.map((s) => ({
        id: s.id,
        name: s.name || s.service?.name || "Serviço",
        tasks: p.internalTasks
          .filter((t) => t.projectServiceId === s.id)
          .map((t) => ({ id: t.id, title: t.title, description: t.description ?? null, done: t.done, startDate: t.startDate?.toISOString() ?? null, dueDate: t.dueDate?.toISOString() ?? null, awaitingClient: t.awaitingClient, updates: clientComments(t.comments).map((c) => ({ text: c.text, at: c.at, client: c.by === "client" })) })),
      }));
      const svcIds = new Set(p.serviceSteps.map((s) => s.id));
      const loose = p.internalTasks
        .filter((t) => !t.projectServiceId || !svcIds.has(t.projectServiceId))
        .map((t) => ({ id: t.id, title: t.title, description: t.description ?? null, done: t.done, startDate: t.startDate?.toISOString() ?? null, dueDate: t.dueDate?.toISOString() ?? null, awaitingClient: t.awaitingClient, updates: clientComments(t.comments).map((c) => ({ text: c.text, at: c.at, client: c.by === "client" })) }));
      if (loose.length) services.push({ id: `loose:${p.id}`, name: "Outras tarefas", tasks: loose });
      return { id: p.id, name: p.name, color: PROJECT_TINT[i % PROJECT_TINT.length], services: services.filter((s) => s.tasks.length > 0) };
    });

  // Serviços inclusos nos projetos → cards em "Seus produtos contratados" (após os
  // 3 principais). Cada um leva ao painel do projeto. Exclui o grupo "Outras tarefas".
  const projServiceCards = projectsData.flatMap((p) =>
    p.services
      .filter((s) => !s.id.startsWith("loose:"))
      .map((s) => {
        const total = s.tasks.length;
        const done = s.tasks.filter((t) => t.done).length;
        return { key: `${p.id}:${s.id}`, projectId: p.id, projectName: p.name, color: p.color, name: s.name, allDone: total > 0 && done === total };
      }),
  );

  // Itens que dependem de uma AÇÃO do cliente (tarefas "aguardando você") — vão no topo.
  const awaitingItems = projects.flatMap((p) =>
    p.internalTasks
      .filter((t) => t.awaitingClient)
      .map((t) => ({ id: t.id, title: t.title, projectId: p.id, projectName: p.name })),
  );

  function Poster({ c }: { c: (typeof cards)[number] }) {
    const st = STATUS[c.status] ?? { label: c.status, tone: "muted" };
    return (
      <Link href={`/meu-espaco/${c.id}`} className="poster">
        <div className="cover" style={{ background: c.cover }}>
          <span className={`badge ${st.tone}`}>{st.label}</span>
          <span className="pico">{c.name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="pbody">
          <h3>{c.name}</h3>
          {(c.service?.name || c.description) && <div className="psub">{c.service?.name ?? c.description}</div>}
          {c.total > 0 && <div className="prog"><i style={{ width: `${c.pct}%` }} /></div>}
          <div className="pnext">
            {c.overdue > 0
              ? <><span className="dotw" /> <b className="warn">{c.overdue} em atraso</b></>
              : c.nextDue
                ? <>Próxima entrega: <b>{fmtDM(c.nextDue)}</b></>
                : c.total > 0
                  ? <>{c.done}/{c.total} concluído</>
                  : <>Abrir painel</>}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="cli">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* HERO + AGUARDANDO VOCÊ */}
      <section className="hero">
        <div className="herogrid">
          <div>
            <div className="eyebrow">Olá{userName ? `, ${userName}` : ""} · {company.name}</div>
            {awaitingItems.length > 0 ? (
              <>
                <h1>Você tem <em>{awaitingItems.length === 1 ? "1 coisa" : `${awaitingItems.length} coisas`}</em> esperando por você.</h1>
                <p>Resolvendo o que está do seu lado, a gente já segue com tudo.</p>
              </>
            ) : (
              <>
                <h1>Tudo caminhando por aqui. 👌</h1>
                <p>Acompanhe abaixo cada serviço, o andamento e os materiais entregues.</p>
              </>
            )}
          </div>
          {awaitingItems.length > 0 && (
            <div className="awaitbox">
              <div className="awaith"><span className="awaitn">{awaitingItems.length}</span> Aguardando você</div>
              {awaitingItems.slice(0, 4).map((it) => (
                <Link key={it.id} href={`/meu-espaco/${it.projectId}`} className="awaititem">
                  <span className="awi-ic">✍️</span>
                  <span className="awi-tx"><span className="awi-t">{it.title}</span><span className="awi-p">{it.projectName}</span></span>
                  <span className="awi-go">Responder →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SEUS PRODUTOS CONTRATADOS — LeadHub (sistema) + serviços contratados do cliente */}
      <section className="row">
        <div className="rowhead"><h2>Seus produtos contratados</h2><span className="sub">o que é seu e está ativo com a gente</span></div>
        <div className="rail">
          <Link href="/dashboard" className="prod">
            <span className="pic" style={{ background: "linear-gradient(135deg,#6E86FF,#9B7BFF)" }}>⚡</span>
            <div className="pb">
              <b>LeadHub</b>
              <span className="psb">seu sistema de gestão</span>
              <span className="st ok">Ativo</span>
              <span className="pr">Acessar o sistema →</span>
            </div>
          </Link>
          {showVideos && videoCount > 0 && (
            <Link href="/meu-espaco/videos" className="prod vidcard">
              <span className="pic" style={{ background: "linear-gradient(135deg,#EC4899,#8B5CF6)" }}>🎬</span>
              <div className="pb">
                <b>Central de vídeos</b>
                <span className="psb">seus materiais em vídeo</span>
                <span className="st vid">{videoCount} vídeo{videoCount === 1 ? "" : "s"}</span>
                <span className="pr">Assistir →</span>
              </div>
            </Link>
          )}
          {(() => {
            const openTotal = invoicesRaw.filter((v) => v.status === "ABERTO").reduce((s, v) => s + v.amountCents, 0);
            return (
              <Link href="/meu-espaco/financeiro" className="prod">
                <span className="pic" style={{ background: "linear-gradient(135deg,#10B981,#0D9488)" }}>$</span>
                <div className="pb">
                  <b>Financeiro</b>
                  <span className="psb">notas e cobranças</span>
                  <span className={`st ${openTotal > 0 ? "warn" : "ok"}`}>{openTotal > 0 ? `Em aberto: ${brl(openTotal)}` : "Em dia"}</span>
                  <span className="pr">Ver financeiro →</span>
                </div>
              </Link>
            );
          })()}
          {projServiceCards.map((s) => (
            <Link key={s.key} href={`/meu-espaco/${s.projectId}`} className="prod">
              <span className="pic" style={{ background: s.color }}>{s.name.charAt(0).toUpperCase()}</span>
              <div className="pb">
                <b>{s.name}</b>
                <span className="psb">{s.projectName}</span>
                <span className={`st ${s.allDone ? "ok" : "info"}`}>{s.allDone ? "Concluído" : "Em andamento"}</span>
                <span className="pr">Ver projeto →</span>
              </div>
            </Link>
          ))}
          {contractedRaw.map((c, i) => {
            const st = c.status === "ATIVO" ? { l: "Ativo", t: "ok" } : c.status === "PAUSADO" ? { l: "Pausado", t: "warn" } : { l: "Em implantação", t: "info" };
            const Inner = (
              <>
                <span className="pic" style={{ background: COVERS[i % COVERS.length] }}>{c.label.charAt(0).toUpperCase()}</span>
                <div className="pb">
                  <b>{c.label}</b>
                  {c.service?.name && <span className="psb">{c.service.name}</span>}
                  <span className={`st ${st.t}`}>{st.l}</span>
                  {c.renewsAt && <span className="pr" style={{ color: "var(--ink3)" }}>🔁 renova {c.renewsAt.toLocaleDateString("pt-BR")}</span>}
                  {c.url && <span className="pr">Acessar →</span>}
                </div>
              </>
            );
            return c.url
              ? <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="prod">{Inner}</a>
              : <div key={c.id} className="prod" style={{ cursor: "default" }}>{Inner}</div>;
          })}
        </div>
      </section>

      {/* SEUS PROJETOS + SERVIÇOS EM EXECUÇÃO (com as tarefas) */}
      {projectsData.length > 0 ? (
        <ProjetosServicos projects={projectsData} />
      ) : (
        <section className="row">
          <div className="rowhead"><h2>Seus serviços</h2><span className="sub">tudo que estamos fazendo com você</span></div>
          {cards.length === 0 ? (
            <div className="empty">Nenhum serviço ativo no momento. Assim que algo começar, aparece aqui.</div>
          ) : (
            <div className="rail">{cards.map((c) => <Poster key={c.id} c={c} />)}</div>
          )}
        </section>
      )}

      <MeuEspacoInteracoes tickets={tickets} services={servicesRaw} stats={ticketStats} />
    </div>
  );
}

const CSS = `
.cli{--ok:#4FD1A0;--warn:#F5B564;--info:#7AA0FF;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);color:var(--ink)}
.cli *{box-sizing:border-box}
.hero{position:relative;overflow:hidden;border-radius:24px;padding:36px 32px;color:#F3F4F8;
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.015)),
    radial-gradient(120% 150% at 88% -30%,rgba(110,134,255,.42),transparent 52%),
    radial-gradient(90% 130% at 4% 130%,rgba(139,92,246,.34),transparent 55%),#0A0C14;
  border:1px solid var(--line2);box-shadow:0 40px 90px -46px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)}
.hero::after{content:"";position:absolute;width:320px;height:320px;right:-60px;top:-130px;border-radius:50%;
  background:radial-gradient(circle,rgba(139,131,255,.5),transparent 62%);filter:blur(20px);pointer-events:none}
.hero>*{position:relative;z-index:1}
.herogrid{position:relative;z-index:1;display:grid;grid-template-columns:1.1fr .9fr;gap:26px;align-items:center}
@media(max-width:760px){.herogrid{grid-template-columns:1fr}}
.awaitbox{background:rgba(255,255,255,.05);border:1px solid var(--line2);border-radius:16px;padding:14px}
.awaith{display:flex;align-items:center;gap:9px;font-weight:800;font-size:13px;margin-bottom:10px;color:#fff}
.awaitn{background:#6E86FF;color:#fff;font-weight:800;font-size:12px;min-width:22px;height:22px;border-radius:99px;display:grid;place-items:center;padding:0 6px}
.awaititem{display:flex;align-items:center;gap:11px;padding:10px;border-radius:11px;border:1px solid var(--line);background:rgba(10,12,20,.45);margin-top:8px;text-decoration:none}
.awaititem:hover{border-color:var(--line2)}
.awi-ic{width:28px;height:28px;border-radius:8px;background:rgba(110,134,255,.16);display:grid;place-items:center;font-size:13px;flex:none}
.awi-tx{min-width:0;flex:1;display:flex;flex-direction:column}
.awi-t{font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.awi-p{font-size:11px;color:var(--ink3)}
.awi-go{flex:none;font-size:12px;font-weight:700;color:#8FA4FF;white-space:nowrap}
.hero .eyebrow{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:rgba(243,244,248,.6)}
.hero h1{margin:10px 0 8px;font-size:29px;line-height:1.14;font-weight:800;letter-spacing:-.025em;max-width:18ch;text-wrap:balance;
  background:linear-gradient(180deg,#FFFFFF,#C7CEE0);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero h1 em{font-style:normal;background:linear-gradient(135deg,#8CA0FF,#B79BFF);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{margin:0;color:rgba(243,244,248,.72);font-size:14.5px;max-width:48ch}
.row{margin-top:34px}
.rowhead{display:flex;align-items:baseline;gap:10px;margin:0 2px 14px}
.rowhead h2{margin:0;font-size:17px;font-weight:740;letter-spacing:-.01em}
.rowhead .sub{font-size:13px;color:var(--ink3)}
.rowhead .count{font-size:12px;font-weight:700;color:#0B0E14;background:var(--warn);border-radius:999px;padding:1px 9px}
.rail{display:flex;gap:15px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x mandatory}
.rail::-webkit-scrollbar{height:7px}.rail::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.rail>*{scroll-snap-align:start;flex:none}
.poster{width:248px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;text-decoration:none;color:inherit;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid var(--line);
  box-shadow:0 22px 44px -30px rgba(0,0,0,.9);transition:transform .18s,box-shadow .18s,border-color .18s}
.poster:hover{transform:translateY(-5px);box-shadow:0 34px 60px -28px rgba(30,40,110,.7);border-color:var(--line2)}
.cover{position:relative;height:112px;display:grid;place-items:center;color:#fff}
.cover::after{content:"";position:absolute;inset:0;background:radial-gradient(70% 70% at 50% 30%,rgba(255,255,255,.18),transparent 70%)}
.cover .pico{position:relative;z-index:1;font-size:40px;font-weight:800;opacity:.9;text-shadow:0 4px 14px rgba(0,0,0,.35)}
.cover .badge{position:absolute;top:10px;left:10px;z-index:1;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;
  background:rgba(0,0,0,.34);color:#fff;backdrop-filter:blur(5px);display:inline-flex;align-items:center;gap:5px}
.cover .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.cover .badge.warn{color:#FFD9A1}.cover .badge.ok{color:#8CF0C4}.cover .badge.info{color:#CBD6FF}.cover .badge.muted{color:#D6DAE3}
.pbody{padding:13px 15px 15px;display:flex;flex-direction:column;gap:9px;flex:1}
.pbody h3{margin:0;font-size:15px;font-weight:670;letter-spacing:-.01em}
.pbody .psub{font-size:12.5px;color:var(--ink3);margin-top:-4px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.prog{height:6px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden}
.prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#6E86FF,#9B7BFF)}
.pnext{font-size:12.5px;color:var(--ink2);display:flex;align-items:center;gap:6px;margin-top:auto}
.pnext b{color:var(--ink)}.pnext b.warn{color:var(--warn)}
.pnext .dotw{width:7px;height:7px;border-radius:50%;background:var(--warn);flex:none}
.empty{color:var(--ink3);font-size:14px;padding:26px;border:1px dashed var(--line2);border-radius:16px;text-align:center}

/* Produtos contratados */
.prod{width:262px;display:flex;gap:13px;align-items:flex-start;text-decoration:none;color:inherit;padding:15px;border-radius:15px;
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid var(--line);
  box-shadow:0 22px 44px -30px rgba(0,0,0,.9);transition:transform .18s,box-shadow .18s,border-color .18s}
.prod:hover{transform:translateY(-4px);border-color:rgba(110,134,255,.35);box-shadow:0 32px 56px -30px rgba(46,58,140,.6)}
.prod .pic{width:44px;height:44px;border-radius:12px;flex:none;display:grid;place-items:center;font-size:22px;color:#fff}
.prod .pb{display:flex;flex-direction:column;gap:2px;min-width:0}
.prod .pb b{font-size:15px;font-weight:720;letter-spacing:-.01em}
.prod .pb .psb{font-size:12.5px;color:var(--ink3)}
.prod .pb .st{align-self:flex-start;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;margin-top:4px}
.prod .pb .st.ok{color:var(--ok);background:rgba(79,209,160,.10);border:1px solid rgba(79,209,160,.24)}
.prod .pb .st.info{color:#B6C4FF;background:rgba(110,134,255,.12);border:1px solid rgba(110,134,255,.28)}
.prod .pb .st.warn{color:var(--warn);background:rgba(245,181,100,.12);border:1px solid rgba(245,181,100,.30)}
.prod .pb .pr{font-size:12.5px;font-weight:660;color:#AFC0FF;margin-top:8px}
/* Card de destaque da Central de vídeos */
.prod.vidcard{border-color:rgba(236,72,153,.4);background:linear-gradient(180deg,rgba(236,72,153,.12),rgba(139,92,246,.05))}
.prod.vidcard:hover{border-color:rgba(236,72,153,.6);box-shadow:0 32px 56px -30px rgba(236,72,153,.55)}
.prod.vidcard .pic{box-shadow:0 8px 20px -8px rgba(236,72,153,.7)}
.prod.vidcard .pr{color:#F3A9D2}
.prod .pb .st.vid{color:#F5B7DB;background:rgba(236,72,153,.14);border:1px solid rgba(236,72,153,.34)}

/* Financeiro */
.finopen{font-size:13px;font-weight:700;color:var(--warn)}
.finmore{margin-left:auto;font-size:13px;font-weight:650;color:#AFC0FF;text-decoration:none;white-space:nowrap}
.finmore:hover{color:#fff}
.finok{color:var(--ink3);font-size:14px;padding:18px;border:1px dashed var(--line2);border-radius:14px;text-align:center}
.finlist{display:flex;flex-direction:column;gap:10px}
.finrow{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;
  background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid var(--line)}
.finval{font-size:16px;font-weight:760;letter-spacing:-.01em;white-space:nowrap;flex:none;min-width:104px}
.finmid{flex:1;min-width:0}
.finmid .findesc{font-size:14px;font-weight:600}
.finmid .finmeta{font-size:12px;color:var(--ink3);margin-top:2px}
.finpill{flex:none;font-size:11px;font-weight:650;padding:4px 11px;border-radius:99px;white-space:nowrap;border:1px solid transparent}
.finpill.ok{color:var(--ok);background:rgba(79,209,160,.10);border-color:rgba(79,209,160,.24)}
.finpill.open{color:var(--warn);background:rgba(245,181,100,.12);border-color:rgba(245,181,100,.3)}
.finpill.late{color:#FCA5A5;background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.3)}
.finact{display:flex;align-items:center;gap:10px;flex:none}
.finbtn{font-size:12.5px;font-weight:660;color:#fff;text-decoration:none;white-space:nowrap;padding:8px 14px;border-radius:9px;
  background:linear-gradient(135deg,#6E86FF,#9B7BFF);box-shadow:0 8px 20px -10px rgba(110,134,255,.7)}
.finlk{font-size:12.5px;font-weight:650;color:#AFC0FF;text-decoration:none;white-space:nowrap}
@media (max-width:560px){.finrow{flex-wrap:wrap}.finval{min-width:0}.finact{width:100%}}

/* Contador de chamados */
.tkstats{display:flex;gap:10px;flex-wrap:wrap;margin:0 2px 15px}
.acrow{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0 2px 16px}
.acrow .actcard{width:auto}
@media(max-width:640px){.acrow{grid-template-columns:1fr}}
.demands{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.02);overflow:hidden;margin:0 2px}
.dhead{padding:12px 16px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);border-bottom:1px solid var(--line)}
.drow{display:flex;align-items:center;gap:13px;padding:13px 16px;border-top:1px solid var(--line);cursor:pointer;transition:background .12s}
.drow:first-of-type{border-top:0}
.drow:hover{background:rgba(255,255,255,.03)}
.didx{width:24px;height:24px;border-radius:8px;background:rgba(255,255,255,.05);color:var(--ink3);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none;font-variant-numeric:tabular-nums}
.dmid{flex:1;min-width:0}
.dtt{font-size:14px;font-weight:640;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsub{font-size:11.5px;color:var(--ink3);margin-top:1px}
.dwhen{font-size:11.5px;color:var(--ink3);white-space:nowrap;flex:none;min-width:64px;text-align:right}
.tkstat{display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid var(--line)}
.tkstat .dot{width:8px;height:8px;border-radius:50%;flex:none}
.tkstat b{font-size:19px;font-weight:800;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.tkstat span{font-size:11.5px;color:var(--ink3);font-weight:600}
.tkstat.open .dot{background:#6E86FF} .tkstat.open b{color:#B6C4FF}
.tkstat.prog .dot{background:#F5B564} .tkstat.prog b{color:#F5B564}
.tkstat.done .dot{background:#4FD1A0} .tkstat.done b{color:#4FD1A0}

/* Ações: abrir chamado / pedir extra — CTAs (visual distinto dos chamados) */
.actcard{width:262px;display:flex;align-items:center;gap:13px;text-align:left;cursor:pointer;padding:16px;border-radius:16px;position:relative;
  color:var(--ink);border:1px solid rgba(110,134,255,.45);background:linear-gradient(135deg,rgba(110,134,255,.22),rgba(155,123,255,.12));transition:.16s}
.actcard::after{content:"+";position:absolute;top:9px;right:14px;font-size:20px;font-weight:700;color:#B6C4FF;opacity:.65;line-height:1}
.actcard:hover{transform:translateY(-4px);box-shadow:0 26px 50px -28px rgba(80,100,255,.6)}
.actcard.ped{border-color:rgba(155,123,255,.5);background:linear-gradient(135deg,rgba(155,123,255,.24),rgba(236,72,153,.12))}
.actcard.ped::after{color:#E7B8FF}
.actcard.ped:hover{box-shadow:0 26px 50px -28px rgba(155,123,255,.55)}
.actcard .acic{width:46px;height:46px;border-radius:13px;flex:none;display:grid;place-items:center;font-size:22px;
  background:linear-gradient(135deg,#6E86FF,#9B7BFF);border:none;box-shadow:0 8px 18px -6px rgba(110,134,255,.6)}
.actcard.ped .acic{background:linear-gradient(135deg,#9B7BFF,#EC4899)}
.actcard .acb{display:flex;flex-direction:column;gap:2px;min-width:0}
.actcard .acb b{font-size:15px;font-weight:720}
.actcard .acb span{font-size:12.5px;color:var(--ink2)}

/* Ticket card */
.tkt{width:272px;display:flex;flex-direction:column;gap:9px;padding:15px;border-radius:14px;
  background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid var(--line)}
.tkt .tkttop{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tkt h3{margin:0;font-size:14.5px;font-weight:640;letter-spacing:-.01em;line-height:1.3}
.tkt .tktmeta{font-size:12px;color:var(--ink3);margin-top:auto}
.tktype{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:6px}
.tktype.sup{color:#CBD6FF;background:rgba(110,134,255,.14);border:1px solid rgba(110,134,255,.3)}
.tktype.ped{color:#D9C7FF;background:rgba(155,123,255,.16);border:1px solid rgba(155,123,255,.32)}
.pill{font-size:11px;font-weight:650;padding:3px 10px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
.pill.info{color:#B6C4FF;background:rgba(110,134,255,.12);border-color:rgba(110,134,255,.28)}
.pill.ok{color:var(--ok);background:rgba(79,209,160,.10);border-color:rgba(79,209,160,.24)}
.pill.muted{color:var(--ink3);background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1)}

/* Catálogo (disponível) */
.poster.avail .cover{filter:saturate(.85)}
.poster.avail .cover::before{content:"";position:absolute;inset:0;background:rgba(6,7,12,.28)}
.benefit{font-size:12.5px;color:var(--ink2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.btnint{margin-top:auto;border:1px solid rgba(110,134,255,.4);background:rgba(110,134,255,.12);color:#C3CEFF;
  font-weight:660;font-size:13px;padding:8px 12px;border-radius:10px;cursor:pointer;transition:.15s}
.btnint:hover{background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;border-color:transparent}

/* Modal */
.mkov{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.7);backdrop-filter:blur(4px)}
.mkcard{width:100%;max-width:480px;border-radius:18px;background:#0C0F17;border:1px solid var(--line2);box-shadow:0 40px 90px -40px rgba(0,0,0,.9)}
.mkhead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)}
.mkhead b{font-size:14.5px;font-weight:700}
.mkx{background:none;border:none;color:var(--ink3);font-size:15px;cursor:pointer}
.mkx:hover{color:var(--ink)}
.mkbody{padding:16px 18px;display:flex;flex-direction:column;gap:6px}
.mkbody label{font-size:12px;color:var(--ink3);margin-top:6px}
.mkbody input,.mkbody textarea{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--line2);border-radius:10px;
  color:var(--ink);font-size:14px;padding:10px 12px;outline:none;font-family:inherit;resize:vertical}
.mkbody input:focus,.mkbody textarea:focus{border-color:#6E86FF}
.mkerr{color:#FCA5A5;font-size:12.5px;margin:4px 0 0}
.mkfoot{display:flex;justify-content:flex-end;gap:10px;padding:14px 18px;border-top:1px solid var(--line)}
.mkcancel{background:none;border:none;color:var(--ink2);font-size:13.5px;cursor:pointer;padding:9px 12px}
.mksend{background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;border:none;border-radius:10px;font-weight:660;font-size:13.5px;padding:9px 18px;cursor:pointer}
.mksend:disabled{opacity:.55}
svg{display:block}
`;

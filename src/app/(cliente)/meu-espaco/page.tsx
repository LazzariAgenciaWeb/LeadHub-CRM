import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import MeuEspacoInteracoes from "./MeuEspacoInteracoes";

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

  const projects = await prisma.setorClickupList.findMany({
    where:   { clientCompanyId: companyId, status: { not: "CANCELADO" } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, name: true, description: true, status: true,
      internalTasks: { select: { done: true, dueDate: true } },
    },
  });

  // Chamados/pedidos do cliente + catálogo de serviços da agência (só nome+descrição).
  const [ticketsRaw, servicesRaw] = await Promise.all([
    prisma.ticket.findMany({
      where:   { clientCompanyId: companyId },
      orderBy: [{ createdAt: "desc" }],
      take:    12,
      select:  { id: true, title: true, category: true, status: true, createdAt: true },
    }),
    prisma.service.findMany({
      where:   { companyId: company.parentCompanyId, isActive: true },
      orderBy: [{ order: "asc" }],
      take:    12,
      select:  { id: true, name: true, description: true },
    }),
  ]);
  const tickets = ticketsRaw.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));

  const now = new Date();
  const cards = projects.map((p, i) => {
    const total = p.internalTasks.length;
    const done = p.internalTasks.filter((t) => t.done).length;
    const overdue = p.internalTasks.filter((t) => !t.done && t.dueDate && new Date(t.dueDate) < now).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const nextDue = p.internalTasks
      .filter((t) => !t.done && t.dueDate && new Date(t.dueDate) >= now)
      .map((t) => new Date(t.dueDate as Date))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { ...p, total, done, overdue, pct, nextDue, cover: COVERS[i % COVERS.length] };
  });

  const attention = cards.filter((c) => c.status === "AGUARDANDO_CLIENTE" || c.overdue > 0);
  const attentionCount = attention.length;

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
          {c.description && <div className="psub">{c.description}</div>}
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

      {/* HERO */}
      <section className="hero">
        <div className="eyebrow">Olá{userName ? `, ${userName}` : ""} · {company.name}</div>
        {attentionCount > 0 ? (
          <>
            <h1>Você tem <em>{attentionCount === 1 ? "1 coisa" : `${attentionCount} coisas`}</em> esperando por você.</h1>
            <p>Dê uma olhada no que precisa da sua atenção — leva pouquinho e a gente já segue com tudo.</p>
          </>
        ) : (
          <>
            <h1>Tudo caminhando por aqui. 👌</h1>
            <p>Acompanhe abaixo cada serviço, o andamento e os materiais entregues.</p>
          </>
        )}
      </section>

      {/* PRECISA DA SUA ATENÇÃO */}
      {attentionCount > 0 && (
        <section className="row">
          <div className="rowhead"><h2>Precisa da sua atenção</h2><span className="count">{attentionCount}</span></div>
          <div className="rail">{attention.map((c) => <Poster key={c.id} c={c} />)}</div>
        </section>
      )}

      {/* SEUS SERVIÇOS */}
      <section className="row">
        <div className="rowhead"><h2>Seus serviços</h2><span className="sub">tudo que estamos fazendo com você</span></div>
        {cards.length === 0 ? (
          <div className="empty">Nenhum serviço ativo no momento. Assim que algo começar, aparece aqui.</div>
        ) : (
          <div className="rail">{cards.map((c) => <Poster key={c.id} c={c} />)}</div>
        )}
      </section>

      {/* SEUS PRODUTOS CONTRATADOS — hoje o próprio LeadHub (o sistema é um serviço contratado) */}
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
        </div>
      </section>

      <MeuEspacoInteracoes tickets={tickets} services={servicesRaw} />
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
.prod .pb .pr{font-size:12.5px;font-weight:660;color:#AFC0FF;margin-top:8px}

/* Ações: abrir chamado / pedir extra */
.actcard{width:262px;display:flex;align-items:center;gap:13px;text-align:left;cursor:pointer;padding:16px;border-radius:16px;
  color:var(--ink);border:1px solid var(--line2);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));transition:.16s}
.actcard:hover{transform:translateY(-4px);box-shadow:0 30px 54px -30px rgba(0,0,0,.9)}
.actcard.sup{border-color:rgba(110,134,255,.4)} .actcard.sup:hover{box-shadow:0 26px 50px -28px rgba(80,100,255,.55)}
.actcard.ped{border-color:rgba(155,123,255,.45)} .actcard.ped:hover{box-shadow:0 26px 50px -28px rgba(155,123,255,.5)}
.actcard .acic{width:46px;height:46px;border-radius:13px;flex:none;display:grid;place-items:center;font-size:22px;background:rgba(255,255,255,.06);border:1px solid var(--line2)}
.actcard .acb{display:flex;flex-direction:column;gap:2px;min-width:0}
.actcard .acb b{font-size:15px;font-weight:720}
.actcard .acb span{font-size:12.5px;color:var(--ink3)}

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

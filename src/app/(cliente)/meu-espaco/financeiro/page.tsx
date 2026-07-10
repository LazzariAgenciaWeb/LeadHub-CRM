import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (d: Date) => d.toLocaleDateString("pt-BR");

export default async function FinanceiroPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { parentCompanyId: true } });
  if (!company?.parentCompanyId) redirect("/dashboard");

  const invoices = await prisma.clientInvoice.findMany({
    where:   { clientCompanyId: companyId, status: { not: "CANCELADO" } },
    orderBy: [{ dueDate: "asc" }],
    select:  { id: true, description: true, amountCents: true, dueDate: true, status: true, paidAt: true, boletoUrl: true, invoiceUrl: true, referenceMonth: true },
  });

  const now = new Date();
  const abertas = invoices.filter((v) => v.status === "ABERTO");
  const pagas = invoices.filter((v) => v.status === "PAGO").sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0));
  const openTotal = abertas.reduce((s, v) => s + v.amountCents, 0);
  const overdue = abertas.filter((v) => new Date(v.dueDate) < now);
  const overdueTotal = overdue.reduce((s, v) => s + v.amountCents, 0);
  const nextDue = abertas.map((v) => new Date(v.dueDate)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  function Row({ v }: { v: (typeof invoices)[number] }) {
    const overdueRow = v.status === "ABERTO" && new Date(v.dueDate) < now;
    const pill = v.status === "PAGO" ? { l: "Pago", t: "ok" } : overdueRow ? { l: "Atrasado", t: "late" } : { l: "Em aberto", t: "open" };
    return (
      <div className={`frow ${pill.t}`}>
        <span className="fbar" />
        <div className="fval">{brl(v.amountCents)}</div>
        <div className="fmid">
          <div className="fdesc">{v.description}</div>
          <div className="fmeta">
            {v.status === "PAGO" && v.paidAt ? <>Liquidado em {fmtD(new Date(v.paidAt))}</> : <>Vencimento {fmtD(new Date(v.dueDate))}</>}
          </div>
        </div>
        <span className={`fpill ${pill.t}`}>{pill.l}</span>
        <div className="fact">
          {v.status !== "PAGO" && v.boletoUrl && <a href={v.boletoUrl} target="_blank" rel="noreferrer" className="fbtn">Pagar boleto</a>}
          {v.invoiceUrl && <a href={v.invoiceUrl} target="_blank" rel="noreferrer" className="flk">Nota fiscal</a>}
        </div>
      </div>
    );
  }

  return (
    <div className="fin">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="fhd">
        <Link href="/meu-espaco" className="fback">← Voltar</Link>
        <h1>Financeiro</h1>
        <p>Suas contas, boletos e notas fiscais em um só lugar.</p>
      </div>

      <div className="kpis">
        <div className="kpi warn">
          <span className="kl">Em aberto</span>
          <b>{brl(openTotal)}</b>
          <span className="ks">{abertas.length} {abertas.length === 1 ? "conta" : "contas"}</span>
        </div>
        <div className="kpi late">
          <span className="kl">Atrasado</span>
          <b>{brl(overdueTotal)}</b>
          <span className="ks">{overdue.length} {overdue.length === 1 ? "conta" : "contas"}</span>
        </div>
        <div className="kpi">
          <span className="kl">Próximo vencimento</span>
          <b>{nextDue ? fmtD(nextDue) : "—"}</b>
          <span className="ks">{nextDue ? "a pagar" : "tudo em dia"}</span>
        </div>
      </div>

      <section className="fsec">
        <div className="fsh"><h2>A pagar</h2><span className="fc">{abertas.length}</span></div>
        {abertas.length === 0 ? (
          <div className="fempty">Nenhuma conta em aberto. 🎉</div>
        ) : (
          <div className="flist">{abertas.map((v) => <Row key={v.id} v={v} />)}</div>
        )}
      </section>

      {pagas.length > 0 && (
        <section className="fsec">
          <div className="fsh"><h2>Pagas</h2><span className="fc">{pagas.length}</span></div>
          <div className="flist">{pagas.map((v) => <Row key={v.id} v={v} />)}</div>
        </section>
      )}

      {invoices.length === 0 && <div className="fempty" style={{ marginTop: 20 }}>Nenhuma cobrança por aqui ainda.</div>}
    </div>
  );
}

const CSS = `
.fin{--ok:#4FD1A0;--warn:#F5B564;--late:#F87171;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);color:var(--ink)}
.fin *{box-sizing:border-box}
.fback{font-size:13px;font-weight:600;color:var(--ink3);text-decoration:none}
.fback:hover{color:var(--ink)}
.fhd h1{margin:8px 0 4px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(180deg,#FFFFFF,#C7CEE0);-webkit-background-clip:text;background-clip:text;color:transparent}
.fhd p{margin:0 0 22px;font-size:14px;color:var(--ink2)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
@media (max-width:640px){.kpis{grid-template-columns:1fr}}
.kpi{padding:18px 20px;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid var(--line);display:flex;flex-direction:column;gap:4px}
.kpi .kl{font-size:12px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3)}
.kpi b{font-size:24px;font-weight:800;letter-spacing:-.02em}
.kpi .ks{font-size:12px;color:var(--ink3)}
.kpi.warn b{color:var(--warn)} .kpi.late b{color:var(--late)}
.kpi.warn{border-color:rgba(245,181,100,.28)} .kpi.late{border-color:rgba(248,113,113,.28)}
.fsec{margin-top:26px}
.fsh{display:flex;align-items:center;gap:8px;margin:0 2px 12px}
.fsh h2{margin:0;font-size:16px;font-weight:740}
.fsh .fc{font-size:11px;font-weight:700;color:var(--ink3);background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:99px;padding:1px 9px}
.flist{display:flex;flex-direction:column;gap:10px}
.frow{position:relative;display:flex;align-items:center;gap:14px;padding:15px 16px 15px 18px;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid var(--line)}
.frow .fbar{position:absolute;left:0;top:0;bottom:0;width:4px}
.frow.open .fbar{background:var(--warn)} .frow.late .fbar{background:var(--late)} .frow.ok .fbar{background:var(--ok)}
.frow.late{border-color:rgba(248,113,113,.28)}
.fval{font-size:16px;font-weight:760;letter-spacing:-.01em;white-space:nowrap;flex:none;min-width:110px}
.fmid{flex:1;min-width:0}
.fmid .fdesc{font-size:14px;font-weight:600}
.fmid .fmeta{font-size:12px;color:var(--ink3);margin-top:2px}
.fpill{flex:none;font-size:11px;font-weight:650;padding:4px 11px;border-radius:99px;white-space:nowrap;border:1px solid transparent}
.fpill.ok{color:var(--ok);background:rgba(79,209,160,.10);border-color:rgba(79,209,160,.24)}
.fpill.open{color:var(--warn);background:rgba(245,181,100,.12);border-color:rgba(245,181,100,.3)}
.fpill.late{color:var(--late);background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.3)}
.fact{display:flex;align-items:center;gap:12px;flex:none}
.fbtn{font-size:12.5px;font-weight:660;color:#fff;text-decoration:none;white-space:nowrap;padding:8px 14px;border-radius:9px;background:linear-gradient(135deg,#6E86FF,#9B7BFF);box-shadow:0 8px 20px -10px rgba(110,134,255,.7)}
.flk{font-size:12.5px;font-weight:650;color:#AFC0FF;text-decoration:none;white-space:nowrap}
.fempty{color:var(--ink3);font-size:14px;padding:22px;border:1px dashed var(--line2);border-radius:14px;text-align:center}
@media (max-width:560px){.frow{flex-wrap:wrap}.fval{min-width:0}.fact{width:100%}}
`;

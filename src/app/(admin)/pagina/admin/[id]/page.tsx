import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { canSeeBioAdmin } from "@/lib/bio-page-server";
import { getPageDetail } from "@/lib/bio-page-stats";
import { BIO_PUBLIC_PATH } from "@/lib/bio-page";

// Detalhe de uma Página do Negócio para a agência: funil, cliques por botão,
// de onde vêm as visitas e cada contato com as respostas.

export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const PERIODS = [7, 30, 90] as const;

function Bars({ rows }: { rows: { label: string; count: number }[] }) {
  if (rows.length === 0) return <p className="text-slate-500 text-xs">Sem dados no período.</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="text-xs">
          <div className="flex justify-between gap-2 text-slate-300">
            <span className="truncate">{r.label}</span>
            <span className="text-slate-400 tabular-nums">{r.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#1e2d45] mt-0.5">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function PaginaAdminDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string }>;
}) {
  if (!(await canSeeBioAdmin())) redirect("/dashboard");
  const { id } = await params;
  const { dias } = await searchParams;
  const days = PERIODS.find((p) => String(p) === dias) ?? 30;
  const d = await getPageDetail(id, days);
  if (!d) notFound();

  const f = d.funnel;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const funnel = [
    { label: "Visitas", value: f.views, rate: null },
    { label: "Começaram as perguntas", value: f.quizStarts, rate: pct(f.quizStarts, f.views) },
    { label: "Terminaram", value: f.quizCompletes, rate: pct(f.quizCompletes, f.quizStarts) },
    { label: "Deixaram contato", value: f.leads, rate: pct(f.leads, f.views) },
  ];
  const card = "bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4";

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div>
        <Link href="/pagina/admin" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" /> Páginas dos clientes
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
          <div>
            <h1 className="text-white font-bold text-xl">{d.page.company}</h1>
            <p className="text-slate-500 text-sm flex items-center gap-2">
              {d.page.plan ?? "sem plano"} · {d.page.published ? "no ar" : "rascunho"}
              {d.page.published && (
                <a href={`${BIO_PUBLIC_PATH}/${d.page.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-white">
                  /p/{d.page.slug} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </p>
          </div>
          <div className="flex bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/pagina/admin/${d.page.id}?dias=${p}`}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${p === days ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {p} dias
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {funnel.map((s) => (
          <div key={s.label} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3">
            <div className="text-slate-500 text-[11px]">{s.label}</div>
            <div className="text-white text-xl font-bold">{s.value.toLocaleString("pt-BR")}</div>
            {s.rate && <div className="text-slate-600 text-[11px]">{s.rate}</div>}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className={card}>
          <h2 className="text-white text-sm font-semibold mb-3">Cliques por botão</h2>
          <Bars rows={d.clicks} />
        </section>
        <section className={card}>
          <h2 className="text-white text-sm font-semibold mb-3">De onde vêm as visitas</h2>
          <Bars rows={d.origins} />
        </section>
      </div>

      <section className={card}>
        <h2 className="text-white text-sm font-semibold mb-3">Contatos ({d.submissions.length})</h2>
        {d.submissions.length === 0 ? (
          <p className="text-slate-500 text-xs">Nenhum contato no período.</p>
        ) : (
          <ul className="divide-y divide-[#1e2d45]">
            {d.submissions.map((s) => (
              <li key={s.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm text-white">{s.name ?? "Sem nome"}</span>
                  <a href={`https://wa.me/${s.phone}`} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-300 hover:underline">+{s.phone}</a>
                  {s.email && <span className="text-xs text-slate-400">{s.email}</span>}
                  <span className="text-[11px] text-slate-500 ml-auto">{s.origin} · {WHEN.format(new Date(s.createdAt))}</span>
                </div>
                {s.answers.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {s.answers.map((a, i) => (
                      <li key={i} className="text-[11px] rounded-md bg-[#161f30] border border-[#1e2d45] px-2 py-0.5 text-slate-300">
                        <span className="text-slate-500">{a.question}</span> {a.answer}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.referrals.length > 0 && (
        <section className={card}>
          <h2 className="text-white text-sm font-semibold mb-2">Cadastros que vieram pelo selo desta página</h2>
          <ul className="text-xs text-slate-300 space-y-1">
            {d.referrals.map((r) => (
              <li key={r.slug}>{r.title} <span className="text-slate-500">/p/{r.slug} · {WHEN.format(new Date(r.createdAt))}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

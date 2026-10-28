"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LayoutTemplate, Lock, Loader2 } from "lucide-react";
import type { PageMarketingStats } from "@/lib/bio-page-stats";

/**
 * Bloco da Página do Negócio no relatório de marketing (agência e portal do
 * cliente). Junta no mesmo lugar o que a página trouxe — visitas, quem
 * começou as perguntas, contatos — com o resto do marketing da empresa.
 */
export default function BioPageMarketing({ companyId, days }: { companyId: string; days: number }) {
  const [data, setData] = useState<(PageMarketingStats & { canEdit: boolean }) | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/companies/${companyId}/pagina-stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) { setData(j); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [companyId, days]);

  if (failed) return null;
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-[#0a1220] border border-[#1e2d45] text-slate-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando a Página do Negócio…
      </div>
    );
  }

  // Só o admin da própria empresa ganha o atalho pro editor.
  const editHref = data.canEdit ? "/pagina" : null;

  const head = (
    <div className="flex items-center gap-2">
      <span className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
        <LayoutTemplate className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="text-white text-sm font-semibold">Página do Negócio</h3>
        <p className="text-slate-500 text-[11px]">Link na bio com vitrine e perguntas que viram contato</p>
      </div>
    </div>
  );

  if (!data.hasPage) {
    return (
      <section className="p-4 rounded-xl bg-[#0a1220] border border-[#1e2d45]">
        {head}
        <p className="text-slate-400 text-xs mt-3">
          Ainda não tem página. Ela é grátis: monta em minutos e passa a contar visitas e contatos aqui no relatório.
        </p>
        {editHref && (
          <a href={editHref} className="inline-block mt-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
            Criar minha página
          </a>
        )}
      </section>
    );
  }

  const t = data.totals;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const tiles = [
    { label: "Visitas", value: t.views, hint: null },
    { label: "Cliques", value: t.clicks, hint: null },
    { label: "Começaram as perguntas", value: t.quizStarts, hint: pct(t.quizStarts, t.views) },
    { label: "Contatos", value: t.leads, hint: `${pct(t.leads, t.views)} das visitas` },
  ];

  return (
    <section className="p-4 rounded-xl bg-[#0a1220] border border-[#1e2d45] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">{head}</div>
        <span className={`text-[11px] px-2 py-0.5 rounded-md border ${data.page.published ? "text-emerald-300 border-emerald-500/25 bg-emerald-500/10" : "text-slate-400 border-slate-500/25"}`}>
          {data.page.published ? "no ar" : "rascunho"}
        </span>
        {data.page.published && (
          <a href={`/p/${data.page.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white">
            /p/{data.page.slug} <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {editHref && (
          <a href={editHref} className="text-[11px] text-indigo-300 hover:text-white">Editar página →</a>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((s) => (
          <div key={s.label} className="rounded-lg bg-[#070b14] border border-[#1e2d45] p-3">
            <div className="text-slate-500 text-[11px]">{s.label}</div>
            <div className="text-white text-lg font-bold">{s.value.toLocaleString("pt-BR")}</div>
            {s.hint && <div className="text-slate-600 text-[11px]">{s.hint}</div>}
          </div>
        ))}
      </div>

      {data.detailed ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Bars title="De onde vêm as visitas" rows={data.origins} />
          <Bars title="Cliques por botão" rows={data.clicks} />
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-[#1e2d45] bg-[#070b14] p-3">
          <Lock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            De onde vêm as visitas e quais botões recebem mais cliques aparecem no plano pago — junto com o site, o Google e as campanhas, tudo neste mesmo relatório.
          </p>
        </div>
      )}
    </section>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <h4 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-slate-600 text-xs">Sem dados no período.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map((r) => (
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
      )}
    </div>
  );
}

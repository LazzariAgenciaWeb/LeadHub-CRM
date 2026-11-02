"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type NavSection = { id: string; label: string; icon: LucideIcon };

/**
 * Trilho de ícones fixo à direita: pula entre as seções do projeto (topo,
 * vigência, aprovação, progresso…). Só lista seção que existe na tela — card
 * condicional (sem ClickUp, sem chamados) some do trilho também. A seção à
 * vista fica acesa.
 */
export default function ProjectSectionNav({
  sections, extra,
}: {
  sections: NavSection[];
  /** Botões extras no fim do trilho (ex.: abrir o detalhamento). */
  extra?: React.ReactNode;
}) {
  const [present, setPresent] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const key = sections.map((s) => s.id).join("|");

  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el && el.childElementCount > 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresent(els.map((el) => el.id));
    const seen = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      let best: string | null = null, max = 0;
      for (const el of els) { const r = seen.get(el.id) ?? 0; if (r > max) { max = r; best = el.id; } }
      if (best) setActive(best);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const visible = sections.filter((s) => present.includes(s.id));
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Seções do projeto"
      className="hidden lg:flex fixed right-3 top-1/2 -translate-y-1/2 z-30 flex-col gap-1 p-1.5 rounded-2xl bg-[#0a0f1a]/90 border border-[#1e2d45] backdrop-blur shadow-xl"
    >
      {visible.map((s) => {
        const Icon = s.icon;
        const on = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            title={s.label}
            aria-label={s.label}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className={`group relative p-2 rounded-xl transition-colors ${
              on ? "bg-indigo-500/20 text-indigo-200" : "text-slate-500 hover:text-white hover:bg-[#1e2d45]"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#111827] border border-[#1e2d45] px-2 py-1 text-[11px] text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">
              {s.label}
            </span>
          </button>
        );
      })}
      {extra && <div className="mt-1 pt-1 border-t border-[#1e2d45] flex flex-col gap-1">{extra}</div>}
    </nav>
  );
}

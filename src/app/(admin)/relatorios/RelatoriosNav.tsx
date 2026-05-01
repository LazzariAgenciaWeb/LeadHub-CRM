"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutGrid, BarChart3, Search, Target, Lightbulb, Link2, MessageSquare, LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import { gradStroke, type GradientKey } from "@/components/IconGradients";

type Section = {
  key: string;
  label: string;
  Icon: LucideIcon;
  grad: GradientKey;
  badge?: string;
};

const SECTIONS: Section[] = [
  { key: "geral",         label: "Visão Geral",   Icon: LayoutGrid,    grad: "dashboard"     },
  { key: "marketing",     label: "Marketing",     Icon: BarChart3,     grad: "marketing"     },
  { key: "prospects",     label: "Prospects",     Icon: Search,        grad: "prospeccao", badge: "em breve" },
  { key: "leads",         label: "Leads",         Icon: Target,        grad: "leads",      badge: "em breve" },
  { key: "oportunidades", label: "Oportunidades", Icon: Lightbulb,     grad: "oportunidades", badge: "em breve" },
  { key: "links",         label: "Links",         Icon: Link2,         grad: "links",      badge: "em breve" },
  { key: "whatsapp",      label: "WhatsApp",      Icon: MessageSquare, grad: "whatsapp",   badge: "em breve" },
  { key: "chamados",      label: "Chamados",      Icon: LifeBuoy,      grad: "chamados",   badge: "em breve" },
];

export default function RelatoriosNav({ active }: { active: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "geral") params.delete("secao");
    else params.set("secao", key);
    const qs = params.toString();
    router.push(`/relatorios${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="border-b border-[#1e2d45] bg-[#0a0f1a]/60 backdrop-blur-sm sticky top-0 z-10">
      <div className="flex gap-1 px-4 overflow-x-auto">
        {SECTIONS.map((s) => {
          const isActive = active === s.key;
          const isDisabled = !!s.badge && s.key !== "geral" && s.key !== "marketing";
          return (
            <button
              key={s.key}
              onClick={() => !isDisabled && go(s.key)}
              disabled={isDisabled}
              className={`flex items-center gap-2 px-3 py-3 text-xs font-semibold whitespace-nowrap transition-all border-b-2 -mb-px ${
                isActive
                  ? "border-indigo-500 text-white"
                  : isDisabled
                    ? "border-transparent text-slate-700 cursor-not-allowed"
                    : "border-transparent text-slate-500 hover:text-slate-200"
              }`}
              title={isDisabled ? "Em construção — virá em breve" : s.label}
            >
              <s.Icon
                className="w-4 h-4 flex-shrink-0"
                strokeWidth={2.25}
                stroke={isDisabled ? "currentColor" : gradStroke(s.grad)}
              />
              <span>{s.label}</span>
              {s.badge && !isActive && (
                <span className="text-[9px] uppercase tracking-wider bg-white/5 text-slate-600 px-1 py-px rounded">
                  {s.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

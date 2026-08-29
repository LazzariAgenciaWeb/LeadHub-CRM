"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ListChecks, Download, Award, Boxes, Receipt, Wrench, ChevronDown } from "lucide-react";

const TABS = [
  { href: "/financeiro", label: "Visão geral", Icon: Wallet },
  { href: "/financeiro/lancamentos", label: "Lançamentos do mês", Icon: Receipt },
  { href: "/financeiro/esteira", label: "Esteira pós-venda", Icon: ListChecks },
  { href: "/financeiro/bonificacao", label: "Bonificação", Icon: Award },
];

// Telas de manutenção/ocasionais — fora da navegação diária, num menu só.
const FERRAMENTAS = [
  { href: "/financeiro/servicos", label: "Serviços da carteira", Icon: Boxes },
  { href: "/financeiro/importar", label: "Importar do ClickUp", Icon: Download },
];

export default function FinanceiroTabs() {
  const path = usePathname();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora — menu solto que fica aberto atrapalha a lista abaixo.
  useEffect(() => {
    if (!aberto) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto]);

  const ferramentaAtiva = FERRAMENTAS.some((t) => t.href === path);

  return (
    <div className="flex items-center gap-1 border-b border-[#1e2d45] -mx-6 px-6">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              active
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
          </Link>
        );
      })}

      <div className="ml-auto relative" ref={ref}>
        <button
          onClick={() => setAberto((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            ferramentaAtiva
              ? "border-indigo-500 text-white"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          Ferramentas
          <ChevronDown className={`w-3 h-3 transition-transform ${aberto ? "rotate-180" : ""}`} />
        </button>
        {aberto && (
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[210px] rounded-xl border border-[#1e2d45] bg-[#0f1623] shadow-2xl py-1">
            {FERRAMENTAS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                onClick={() => setAberto(false)}
                className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  path === t.href ? "text-white bg-white/5" : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <t.Icon className="w-3.5 h-3.5" />
                {t.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

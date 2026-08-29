"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ListChecks, Download, Award, Boxes } from "lucide-react";

const TABS = [
  { href: "/financeiro", label: "Visão geral", Icon: Wallet },
  { href: "/financeiro/esteira", label: "Esteira pós-venda", Icon: ListChecks },
  { href: "/financeiro/bonificacao", label: "Bonificação", Icon: Award },
  { href: "/financeiro/servicos", label: "Serviços", Icon: Boxes },
  { href: "/financeiro/importar", label: "Importar do ClickUp", Icon: Download },
];

export default function FinanceiroTabs() {
  const path = usePathname();
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
    </div>
  );
}

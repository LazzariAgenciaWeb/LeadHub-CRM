"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard",          icon: "🏠", label: "Início"    },
  { href: "/whatsapp",           icon: "🗨️",  label: "Mensagens" },
  { href: "/crm/oportunidades",  icon: "🫧",  label: "CRM"      },
  { href: "/chamados",           icon: "🎫",  label: "Chamados" },
  { href: "/assistente",         icon: "🤖",  label: "IA"       },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0f1623] border-t border-[#1e2d45] flex safe-area-pb">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-colors ${
              isActive
                ? "text-indigo-400"
                : "text-slate-500 active:text-slate-300"
            }`}
          >
            <span className="text-[20px] leading-none">{item.icon}</span>
            <span
              className={`text-[9px] font-medium mt-0.5 ${
                isActive ? "text-indigo-400" : "text-slate-600"
              }`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

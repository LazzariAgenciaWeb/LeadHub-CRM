"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Session } from "next-auth";

interface SidebarProps {
  session: Session;
  onClose?: () => void;
}

const CRM_ROUTES = ["/crm/prospeccao", "/crm/leads", "/crm/oportunidades"];

export default function Sidebar({ session, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";

  const isCrmActive = CRM_ROUTES.some((r) => pathname.startsWith(r));
  const [crmOpen, setCrmOpen] = useState(isCrmActive);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  const topLinks = [
    { href: "/dashboard", icon: "🏠", label: "Dashboard" },
    { href: "/whatsapp", icon: "🗨️", label: "Mensagens" },
    { href: "/assistente", icon: "🤖", label: "Assistente IA" },
    ...(isSuperAdmin ? [{ href: "/empresas", icon: "🏢", label: "Empresas" }] : []),
  ];

  const bottomLinks = [
    { href: "/campanhas", icon: "📣", label: "Campanhas" },
    { href: "/chamados", icon: "🎫", label: "Chamados" },
    { href: "/links", icon: "🔗", label: "Links" },
    { href: "/relatorios", icon: "📈", label: "Relatórios" },
    { href: "/configuracoes", icon: "⚙️", label: "Configurações" },
  ];

  const crmSubItems = [
    { href: "/crm/prospeccao", icon: "🔎", label: "Prospecção" },
    { href: "/crm/leads", icon: "🎯", label: "Leads" },
    { href: "/crm/oportunidades", icon: "💡", label: "Oportunidades" },
  ];

  return (
    <aside className="w-[220px] min-w-[220px] bg-[#0f1623] border-r border-[#1e2d45] flex flex-col">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#1e2d45] flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm flex-shrink-0">
          ⚡
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-base leading-none">LeadHub</div>
          <div className="text-slate-500 text-[10px] mt-0.5">
            {isSuperAdmin ? "Super Admin" : "Marketing CRM"}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-[#1e2d45] transition-colors flex-shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2.5 pt-3 overflow-y-auto">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 mb-2">
          {isSuperAdmin ? "Administração" : "Menu"}
        </div>

        {/* Links do topo */}
        {topLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium mb-0.5 transition-all ${
              isActive(link.href)
                ? "bg-indigo-500/15 text-indigo-400 border-l-2 border-indigo-500"
                : "text-slate-400 hover:bg-[#161f30] hover:text-white"
            }`}
          >
            <span className="text-[15px] w-5 text-center">{link.icon}</span>
            {link.label}
          </Link>
        ))}

        {/* CRM — grupo expansível */}
        <div className="mb-0.5">
          <button
            onClick={() => setCrmOpen(!crmOpen)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
              isCrmActive
                ? "bg-indigo-500/15 text-indigo-400"
                : "text-slate-400 hover:bg-[#161f30] hover:text-white"
            }`}
          >
            <span className="text-[15px] w-5 text-center">🫧</span>
            <span className="flex-1 text-left">CRM</span>
            <span className={`text-[10px] transition-transform ${crmOpen ? "rotate-90" : ""}`}>▶</span>
          </button>

          {crmOpen && (
            <div className="ml-3 mt-0.5 pl-3 border-l border-[#1e2d45] space-y-0.5">
              {crmSubItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                    isActive(item.href)
                      ? "bg-indigo-500/15 text-indigo-400 border-l-2 border-indigo-500"
                      : "text-slate-500 hover:bg-[#161f30] hover:text-white"
                  }`}
                >
                  <span className="text-[13px] w-4 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Links do fundo */}
        {bottomLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium mb-0.5 transition-all ${
              isActive(link.href)
                ? "bg-indigo-500/15 text-indigo-400 border-l-2 border-indigo-500"
                : "text-slate-400 hover:bg-[#161f30] hover:text-white"
            }`}
          >
            <span className="text-[15px] w-5 text-center">{link.icon}</span>
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2.5 border-t border-[#1e2d45]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#161f30]">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {session.user?.name?.charAt(0).toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-[12px] font-semibold truncate">
              {session.user?.name}
            </div>
            <div className="text-indigo-400 text-[10px] font-semibold">
              {isSuperAdmin ? "Super Admin" : "Cliente"}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-slate-500 hover:text-white text-sm transition-colors"
            title="Sair"
          >
            ↪
          </button>
        </div>
      </div>
    </aside>
  );
}

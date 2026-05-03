"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Session } from "next-auth";
import Sidebar from "./Sidebar";
import MobileBottomNav from "./MobileBottomNav";
import BadgeToastNotifier from "./BadgeToastNotifier";

interface LayoutShellProps {
  children: React.ReactNode;
  session: Session;
  banner?: React.ReactNode;
}

export default function LayoutShell({ children, session, banner }: LayoutShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Fechar sidebar ao navegar
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Impedir scroll do body quando sidebar aberta no mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen bg-[#080b12] overflow-hidden">

      {/* ── Sidebar desktop: sempre visível ── */}
      <div className="hidden lg:block flex-shrink-0">
        <Sidebar session={session} />
      </div>

      {/* ── Sidebar mobile: overlay / drawer ── */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/70 lg:hidden transition-opacity duration-300 ${
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      {/* Drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar session={session} onClose={() => setSidebarOpen(false)} />
      </div>

      {/* ── Conteúdo principal ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header mobile */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 bg-[#0f1623] border-b border-[#1e2d45] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2d45] transition-colors active:bg-[#1e2d45]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6"  />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[7px] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm">
              ⚡
            </div>
            <span className="text-white font-bold text-[15px]">LeadHub</span>
          </div>
        </div>

        {/* Banner de impersonation */}
        {banner}

        {/* Área de conteúdo — com padding-bottom no mobile para não ficar atrás da bottom nav */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {children}
        </main>

        {/* Bottom nav mobile */}
        <MobileBottomNav />
      </div>

      {/* Toast global de novos badges (polling silencioso) */}
      <BadgeToastNotifier />
    </div>
  );
}

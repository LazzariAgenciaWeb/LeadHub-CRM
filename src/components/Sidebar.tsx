"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { Session } from "next-auth";
import { isAdmin, isSuperAdmin, can, hasModule } from "@/lib/permissions";
import {
  Zap, X, Home, MessageSquare, Sparkles, Building2, Briefcase,
  Search, Target, Lightbulb, Megaphone, LifeBuoy, Link2, TrendingUp,
  Settings, ChevronRight, ChevronUp, LogOut, ArrowLeft, type LucideIcon,
} from "lucide-react";

interface SidebarProps {
  session: Session;
  onClose?: () => void;
}

interface Company {
  id: string;
  name: string;
}

const CRM_ROUTES = ["/crm/prospeccao", "/crm/leads", "/crm/oportunidades"];

export default function Sidebar({ session, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const _isSuperAdmin = isSuperAdmin(session);
  const _isAdmin = isAdmin(session);
  const role = (session.user as any)?.role;
  const _impersonating = (session as any)._impersonating as { companyId: string; companyName: string } | undefined;

  const isCrmActive = CRM_ROUTES.some((r) => pathname.startsWith(r));
  const [crmOpen, setCrmOpen] = useState(isCrmActive);

  // Dropdown de troca de empresa / logout
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Carregar empresas quando SuperAdmin abre o dropdown
  async function handleDropdownOpen() {
    setDropdownOpen((prev) => !prev);
    if (!dropdownOpen && _isSuperAdmin && companies.length === 0) {
      setLoadingCompanies(true);
      try {
        const res = await fetch("/api/companies");
        if (res.ok) {
          const data = await res.json();
          setCompanies(Array.isArray(data) ? data : (data.companies ?? []));
        }
      } finally {
        setLoadingCompanies(false);
      }
    }
  }

  function handleImpersonate(companyId: string) {
    setDropdownOpen(false);
    router.push(`/api/admin/impersonate/${companyId}`);
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // Label do papel do usuário
  const roleLabel =
    role === "SUPER_ADMIN" ? "Super Admin" :
    role === "ADMIN" ? "Admin" :
    "Agente";

  const topLinks: { href: string; Icon: LucideIcon; label: string; show: boolean }[] = [
    { href: "/dashboard",  Icon: Home,            label: "Dashboard",     show: true },
    { href: "/whatsapp",   Icon: MessageSquare,   label: "Mensagens",     show: _isAdmin || (hasModule(session, "whatsapp") && can(session, "canViewInbox")) },
    { href: "/assistente", Icon: Sparkles,        label: "Assistente IA", show: _isAdmin || (hasModule(session, "ai") && can(session, "canUseAI")) },
    { href: "/empresas",   Icon: Building2,       label: "Empresas",      show: _isAdmin || can(session, "canViewCompanies") },
  ].filter((l) => l.show);

  const showCrm = _isAdmin || (hasModule(session, "crm") && can(session, "canViewLeads"));

  const crmSubItems: { href: string; Icon: LucideIcon; label: string }[] = [
    { href: "/crm/prospeccao",    Icon: Search,    label: "Prospecção" },
    { href: "/crm/leads",         Icon: Target,    label: "Leads" },
    { href: "/crm/oportunidades", Icon: Lightbulb, label: "Oportunidades" },
  ];

  const bottomLinks: { href: string; Icon: LucideIcon; label: string; show: boolean }[] = [
    { href: "/campanhas",     Icon: Megaphone,    label: "Campanhas",     show: _isAdmin },
    { href: "/chamados",      Icon: LifeBuoy,     label: "Chamados",      show: _isAdmin || (hasModule(session, "tickets") && can(session, "canViewTickets")) },
    { href: "/links",         Icon: Link2,        label: "Links",         show: _isAdmin },
    { href: "/relatorios",    Icon: TrendingUp,   label: "Relatórios",    show: _isAdmin },
    { href: "/configuracoes", Icon: Settings,     label: "Configurações", show: _isAdmin || can(session, "canViewConfig") },
  ].filter((l) => l.show);

  return (
    <aside className="w-[220px] min-w-[220px] bg-[#0f1623] border-r border-[#1e2d45] flex flex-col">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#1e2d45] flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-base leading-none">LeadHub</div>
          <div className="text-slate-500 text-[10px] mt-0.5">
            {_isSuperAdmin ? "Super Admin" : "Marketing CRM"}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-[#1e2d45] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2.5 pt-3 overflow-y-auto">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 mb-2">
          {_isSuperAdmin ? "Administração" : "Menu"}
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
            <link.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
            {link.label}
          </Link>
        ))}

        {/* CRM — grupo expansível */}
        {showCrm && (
          <div className="mb-0.5">
            <button
              onClick={() => setCrmOpen(!crmOpen)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                isCrmActive
                  ? "bg-indigo-500/15 text-indigo-400"
                  : "text-slate-400 hover:bg-[#161f30] hover:text-white"
              }`}
            >
              <Briefcase className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
              <span className="flex-1 text-left">CRM</span>
              <ChevronRight className={`w-3 h-3 transition-transform ${crmOpen ? "rotate-90" : ""}`} />
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
                    <item.Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

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
            <link.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2.5 border-t border-[#1e2d45] relative" ref={dropdownRef}>
        {/* Dropdown */}
        {dropdownOpen && (
          <div className="absolute bottom-full left-2.5 right-2.5 mb-1 bg-[#0f1623] border border-[#1e2d45] rounded-xl shadow-xl z-50 overflow-hidden">
            {/* Cabeçalho do dropdown */}
            <div className="px-3 py-2 border-b border-[#1e2d45]">
              <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                {_isSuperAdmin ? "Acessar como empresa" : _impersonating ? "Modo de visualização" : "Conta"}
              </div>
            </div>

            {/* SuperAdmin: lista de empresas */}
            {_isSuperAdmin && (
              <>
                <div className="px-2 pt-2 pb-1">
                  <input
                    type="text"
                    placeholder="Buscar empresa..."
                    value={companySearch}
                    onChange={(e) => setCompanySearch(e.target.value)}
                    className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto pb-1">
                  {loadingCompanies && (
                    <div className="px-3 py-2 text-slate-500 text-xs">Carregando...</div>
                  )}
                  {!loadingCompanies && companies.length === 0 && (
                    <div className="px-3 py-2 text-slate-500 text-xs">Nenhuma empresa encontrada.</div>
                  )}
                  {companies
                    .filter((c) => c.name.toLowerCase().includes(companySearch.toLowerCase()))
                    .map((company) => (
                      <button
                        key={company.id}
                        onClick={() => handleImpersonate(company.id)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-indigo-500/10 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <span className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[10px] text-indigo-400 flex-shrink-0 font-bold">
                          {company.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate">{company.name}</span>
                      </button>
                    ))}
                </div>
                <div className="border-t border-[#1e2d45]" />
              </>
            )}

            {/* Impersonando: botão de voltar */}
            {_impersonating && (
              <>
                <Link
                  href="/api/admin/impersonate/exit"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.25} />
                  <span>Voltar ao Super Admin</span>
                </Link>
                <div className="border-t border-[#1e2d45]" />
              </>
            )}

            {/* Sair — sempre visível */}
            <button
              onClick={() => { setDropdownOpen(false); signOut({ callbackUrl: "/login" }); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={2.25} />
              <span>Sair da conta</span>
            </button>
          </div>
        )}

        {/* Bloco do usuário — clicável para abrir dropdown */}
        <button
          onClick={handleDropdownOpen}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#161f30] hover:bg-[#1a2540] transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {session.user?.name?.charAt(0).toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-white text-[12px] font-semibold truncate">
              {_impersonating ? _impersonating.companyName : session.user?.name}
            </div>
            <div className="text-indigo-400 text-[10px] font-semibold">
              {_impersonating ? "Visualizando empresa" : roleLabel}
            </div>
          </div>
          <ChevronUp className={`w-3.5 h-3.5 text-slate-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
    </aside>
  );
}

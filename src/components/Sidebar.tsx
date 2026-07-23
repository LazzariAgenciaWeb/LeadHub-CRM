"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { Session } from "next-auth";
import { isAdmin, isSuperAdmin, can, hasModule } from "@/lib/permissions";
import {
  Zap, X, Home, MessageSquare, Sparkles, Building2, Briefcase,
  Search, Target, Lightbulb, Megaphone, LifeBuoy, Link2, Shield,
  Settings, ChevronRight, ChevronUp, LogOut, ArrowLeft, CalendarDays,
  BarChart3, Trophy, FolderKanban, UserCircle, Mail, CreditCard, Camera, LayoutGrid, MonitorPlay, Ticket, Lock, type LucideIcon,
} from "lucide-react";
import VersionBadge from "./VersionBadge";
import { gradStroke, type GradientKey } from "./IconGradients";

interface SidebarProps {
  session: Session;
  onClose?: () => void;
  isClient?: boolean;
}

interface Company {
  id: string;
  name: string;
  hasSystemAccess?: boolean;
}

export default function Sidebar({ session, onClose, isClient = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const _isSuperAdmin = isSuperAdmin(session);
  const _isAdmin = isAdmin(session);
  const role = (session.user as any)?.role;
  const _impersonating = (session as any)._impersonating as { companyId: string; companyName: string } | undefined;

  // Estado de abertura dos grupos-accordion do menu (Atrair, Atender, Vender…).
  // Chave = key do grupo. `undefined` => usa o default (grupo abre sozinho se
  // contém a rota ativa). Toggle do usuário grava explicit true/false.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  function toggleGroup(key: string, activeDefault: boolean) {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? activeDefault) }));
  }

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
        // Endpoint específico que lista TODAS empresas com hasSystemAccess=true,
        // independente de hierarquia (top-level ou sub-empresa). Garante que o
        // dropdown sempre mostre quem é impersonável, mesmo após /api/companies
        // passar a respeitar impersonação via getEffectiveSession.
        const res = await fetch("/api/admin/impersonatable-companies");
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
    // window.location (não router.push) — a API retorna um redirect HTTP que precisa
    // ser interpretado pelo browser pra setar o cookie de impersonação.
    window.location.href = `/api/admin/impersonate/${companyId}`;
  }

  function isActive(href: string) {
    // Separa pathname do query string do href
    const [hrefPath, hrefQuery] = href.split("?");

    // /crm é uma página própria, não um prefixo dos sub-routes do CRM
    if (hrefPath === "/crm") return pathname === "/crm";

    // 1. Pathname precisa bater (exato ou descendente)
    if (pathname !== hrefPath && !pathname.startsWith(hrefPath + "/")) return false;

    // 2. Se href tem query string, todos os params declarados precisam bater na URL atual.
    //    Ex: "/relatorios?secao=marketing" só ativa quando secao=marketing está na URL.
    if (hrefQuery) {
      const hrefParams = new URLSearchParams(hrefQuery);
      for (const [key, value] of hrefParams) {
        if (searchParams.get(key) !== value) return false;
      }
      return true;
    }

    // 3. Href sem query: cuidado pra não conflitar com irmãos que usam a mesma rota
    //    com um param de seção. Ex: "/relatorios" NÃO está ativo quando estamos em
    //    "/relatorios?secao=marketing" (porque o irmão "Marketing" é o ativo).
    if (hrefPath === "/relatorios") {
      const secao = searchParams.get("secao");
      if (secao && secao !== "geral") return false;
    }

    return true;
  }

  // Label do papel do usuário
  const roleLabel =
    role === "SUPER_ADMIN" ? "Super Admin" :
    role === "ADMIN" ? "Admin" :
    "Agente";

  // Item do menu. Separa DOIS gates distintos:
  //  - `lockModule`: módulo do PLANO (hasModule). Se a empresa não contratou,
  //    o item aparece BLOQUEADO (esmaecido + cadeado) em vez de sumir.
  //  - `perm`: permissão de PAPEL/SETOR (independe de plano). Sem ela, some.
  type SidebarLink = { href: string; Icon: LucideIcon; label: string; grad: GradientKey; lockModule?: Parameters<typeof hasModule>[1]; perm: boolean };
  type NavGroupDef = { key: string; title: string; Icon: LucideIcon; grad: GradientKey; items: SidebarLink[] };
  type NavItem = SidebarLink & { locked: boolean };
  type NavGroup = { key: string; title: string; Icon: LucideIcon; grad: GradientKey; items: NavItem[] };

  // Configurações é visível para ADMIN/SUPER_ADMIN ou para CLIENT cujo setor
  // tem canViewConfig OU canManageUsers (sector admin que precisa gerenciar
  // usuários/setores também precisa abrir a tela de configurações).
  const showConfig = _isAdmin || can(session, "canViewConfig") || can(session, "canManageUsers");

  // "Visão Geral" (home do dashboard) é link fixo no topo — não entra em grupo.
  const overviewShow = true;

  // Menu organizado por ETAPA da jornada (padrão RD Station), espelhando a
  // taxonomia do plans.ts: Atrair → Atender → Vender → Analisar → Gestão → Sistema.
  // Módulo não contratado = item BLOQUEADO (só pro ADMIN, que decide contratar);
  // pro CLIENT/agente sem o módulo continua escondido. SUPER_ADMIN vê tudo liberado.
  const navGroups: NavGroup[] = ([
    {
      key: "atrair", title: "Atrair", Icon: Megaphone, grad: "campanhas",
      items: [
        { href: "/campanhas",       Icon: Megaphone,   label: "Campanhas",        grad: "campanhas", lockModule: "campanhas", perm: _isAdmin || can(session, "canViewCampanhas") },
        { href: "/links",           Icon: Link2,       label: "Links",            grad: "links",     lockModule: "links",     perm: _isAdmin || can(session, "canViewLinks") },
        { href: "/instagram",       Icon: Camera,      label: "Instagram",        grad: "marketing", lockModule: "instagram", perm: _isAdmin },
        { href: "/campanhas/email", Icon: Mail,        label: "E-mail Marketing", grad: "email",     lockModule: "campanhas", perm: _isAdmin || can(session, "canViewCampanhas") },
      ],
    },
    {
      key: "atender", title: "Atender", Icon: MessageSquare, grad: "whatsapp",
      items: [
        { href: "/whatsapp",        Icon: MessageSquare, label: "Mensagens",    grad: "whatsapp",  lockModule: "whatsapp",  perm: can(session, "canViewInbox") },
        { href: "/instagram/inbox", Icon: Camera,        label: "Inbox Social", grad: "marketing", lockModule: "instagram", perm: _isAdmin },
        { href: "/chamados",        Icon: LifeBuoy,      label: "Chamados",     grad: "chamados",  lockModule: "tickets",   perm: can(session, "canViewTickets") },
        { href: "/assistente",      Icon: Sparkles,      label: "Assistente IA", grad: "ai",       lockModule: "ai",        perm: can(session, "canUseAI") },
      ],
    },
    {
      key: "vender", title: "Vender", Icon: Briefcase, grad: "crm",
      items: [
        { href: "/crm",               Icon: BarChart3, label: "Painel",        grad: "crm",           lockModule: "crm",                    perm: can(session, "canViewLeads") },
        { href: "/crm/prospeccao",    Icon: Search,    label: "Prospecção",    grad: "prospeccao",    lockModule: "crmPipelineProspeccao",  perm: true },
        { href: "/crm/leads",         Icon: Target,    label: "Leads",         grad: "leads",         lockModule: "crmPipelineLeads",       perm: true },
        { href: "/crm/oportunidades", Icon: Lightbulb, label: "Oportunidades", grad: "oportunidades", lockModule: "crmPipelineOportunidades", perm: true },
      ],
    },
    {
      key: "analisar", title: "Analisar", Icon: BarChart3, grad: "marketing",
      items: [
        { href: "/relatorios?secao=marketing", Icon: BarChart3, label: "Marketing", grad: "marketing",   perm: _isAdmin || can(session, "canViewMarketing") },
        { href: "/gamificacao",                Icon: Trophy,    label: "Ranking",   grad: "gamificacao", lockModule: "gamificacao", perm: _isAdmin || can(session, "canViewRanking") },
      ],
    },
    {
      key: "gestao", title: "Gestão", Icon: FolderKanban, grad: "pipeline",
      items: [
        { href: "/empresas",   Icon: Building2,    label: _isSuperAdmin ? "Empresas" : "Clientes", grad: "empresas", perm: _isAdmin || can(session, "canViewCompanies") },
        { href: "/projetos",   Icon: FolderKanban, label: "Projetos",   grad: "pipeline",   lockModule: "projetos",   perm: _isAdmin || can(session, "canViewProjetos") },
        { href: "/calendario", Icon: CalendarDays, label: "Calendário", grad: "calendario", lockModule: "calendario", perm: _isAdmin || can(session, "canViewCalendario") },
        { href: "/videos",     Icon: MonitorPlay,  label: "Vídeos",     grad: "marketing",  lockModule: "videos",     perm: _isAdmin },
        { href: "/cofre",      Icon: Shield,       label: "Cofre",      grad: "cofre",      lockModule: "cofre",      perm: _isAdmin || can(session, "canViewCofre") },
      ],
    },
    {
      key: "sistema", title: "Sistema", Icon: Settings, grad: "configuracoes",
      items: [
        { href: "/cupons",        Icon: Ticket,   label: "Cupons",        grad: "campanhas",     perm: _isSuperAdmin },
        { href: "/configuracoes", Icon: Settings, label: "Configurações", grad: "configuracoes", perm: showConfig },
      ],
    },
  ] as NavGroupDef[])
    .map((g) => {
      const items: NavItem[] = [];
      for (const i of g.items) {
        // Liberado se: super admin, sem gate de módulo, ou módulo contratado.
        const unlocked = _isSuperAdmin || !i.lockModule || hasModule(session, i.lockModule);
        // Aparece se: super admin; se liberado e tem a permissão; ou se bloqueado
        // mas é ADMIN (quem decide contratar vê o cadeado). Agente sem módulo: some.
        const present = _isSuperAdmin ? true : unlocked ? i.perm : _isAdmin;
        if (present) items.push({ ...i, locked: !unlocked });
      }
      return { ...g, items };
    })
    .filter((g) => g.items.length > 0);

  return (
    <aside className="w-[220px] min-w-[220px] h-screen bg-[#0f1623] border-r border-[#1e2d45] flex flex-col">
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

        {/* Atalho da Área do Cliente — só pra empresas cliente (sub-company) */}
        {isClient && (
          <Link
            href="/meu-espaco"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold mb-1.5 transition-all border ${
              isActive("/meu-espaco")
                ? "bg-indigo-500/20 text-white border-indigo-500/50"
                : "bg-indigo-500/10 text-indigo-200 border-indigo-500/25 hover:bg-indigo-500/20 hover:text-white"
            }`}
          >
            <LayoutGrid className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} />
            Meu espaço
          </Link>
        )}

        {/* Planos — atalho fixo do super admin no topo (tem bastante coisa
            importante: tiers, add-ons, cupons, limites). Fora dos grupos. */}
        {_isSuperAdmin && (
          <Link
            href="/planos"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium mb-0.5 transition-all ${
              isActive("/planos")
                ? "bg-indigo-500/15 text-white border-l-2 border-indigo-500"
                : "text-slate-400 hover:bg-[#161f30] hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke("planos")} />
            Planos
          </Link>
        )}

        {/* Visão Geral — link fixo no topo (home do dashboard, não é grupo) */}
        {overviewShow && (
          <Link
            href="/dashboard"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium mb-0.5 transition-all ${
              isActive("/dashboard")
                ? "bg-indigo-500/15 text-white border-l-2 border-indigo-500"
                : "text-slate-400 hover:bg-[#161f30] hover:text-white"
            }`}
          >
            <Home className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke("dashboard")} />
            Visão Geral
          </Link>
        )}

        {/* Grupos por etapa da jornada — cada um é um accordion. Abre sozinho
            quando contém a rota ativa; toggle do usuário sobrescreve. */}
        {navGroups.map((group) => {
          const groupActive = group.items.some((i) => isActive(i.href));
          const isOpen = openGroups[group.key] ?? groupActive;
          return (
            <div key={group.key} className="mb-0.5">
              <button
                onClick={() => toggleGroup(group.key, groupActive)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  groupActive
                    ? "bg-indigo-500/15 text-white"
                    : "text-slate-400 hover:bg-[#161f30] hover:text-white"
                }`}
              >
                <group.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(group.grad)} />
                <span className="flex-1 text-left">{group.title}</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>

              {isOpen && (
                <div className="ml-3 mt-0.5 pl-3 border-l border-[#1e2d45] space-y-0.5">
                  {group.items.map((item) =>
                    item.locked ? (
                      // Módulo não contratado — esmaecido + cadeado, leva ao upsell.
                      <Link
                        key={item.href}
                        href={`/upgrade/${item.lockModule}`}
                        title="Não disponível no seu plano — clique para contratar"
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 opacity-60 hover:opacity-100 hover:bg-[#161f30] hover:text-slate-400 transition-all"
                      >
                        <item.Icon className="w-3.5 h-3.5 flex-shrink-0 grayscale" strokeWidth={2.25} stroke={gradStroke(item.grad)} />
                        <span className="flex-1 truncate">{item.label}</span>
                        <Lock className="w-3 h-3 flex-shrink-0 text-slate-600" strokeWidth={2.5} />
                      </Link>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                          isActive(item.href)
                            ? "bg-indigo-500/15 text-white border-l-2 border-indigo-500"
                            : "text-slate-500 hover:bg-[#161f30] hover:text-white"
                        }`}
                      >
                        <item.Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(item.grad)} />
                        {item.label}
                      </Link>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
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
                    .filter((c) => c.hasSystemAccess !== false) // só empresas com acesso ao sistema
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
                <a
                  href="/api/admin/impersonate/exit"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.25} />
                  <span>Voltar ao Super Admin</span>
                </a>
                <div className="border-t border-[#1e2d45]" />
              </>
            )}

            {/* Meu Perfil — sempre visível, qualquer user edita o próprio perfil */}
            <Link
              href="/configuracoes?secao=meu-perfil"
              onClick={() => setDropdownOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-indigo-500/10 hover:text-white transition-colors"
            >
              <UserCircle className="w-3.5 h-3.5" strokeWidth={2.25} stroke={gradStroke("dashboard")} />
              <span>Meu Perfil</span>
            </Link>

            {/* Configurações — visível para admin/super_admin/sector admin */}
            {showConfig && (
              <Link
                href="/configuracoes"
                onClick={() => setDropdownOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-indigo-500/10 hover:text-white transition-colors"
              >
                <Settings className="w-3.5 h-3.5" strokeWidth={2.25} stroke={gradStroke("configuracoes")} />
                <span>Configurações</span>
              </Link>
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
        <VersionBadge />
      </div>
    </aside>
  );
}

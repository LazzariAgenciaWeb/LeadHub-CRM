"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MessageSquare, Building2, Plug, Zap, CheckSquare, Sparkles, Webhook,
  Workflow, Tag, Clock, Globe, Mail, FileText, Users, KeyRound, Shield, CreditCard, Trophy,
  ChevronDown, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { gradStroke, type GradientKey } from "@/components/IconGradients";

type SectionItem =
  | { type: "item"; key: string; Icon: LucideIcon; grad: GradientKey; label: string; desc: string }
  | {
      type: "group";
      label: string;
      Icon: LucideIcon;
      grad: GradientKey;
      key: string;
      children: { key: string; Icon: LucideIcon; grad: GradientKey; label: string; desc: string }[];
    };

const SECTIONS: SectionItem[] = [
  { type: "item", key: "instancias", Icon: MessageSquare, grad: "instancias", label: "Instâncias WhatsApp", desc: "Números conectados" },
  {
    type: "group",
    key: "minha-empresa",
    Icon: Building2,
    grad: "empresa",
    label: "Minha Empresa",
    children: [
      { key: "minha-empresa-dados",     Icon: FileText,  grad: "empresa",       label: "Dados",       desc: "Nome, logo e informações" },
      { key: "minha-empresa-contatos",  Icon: Users,     grad: "whatsapp",      label: "Contatos",    desc: "Pessoas e grupos do WhatsApp" },
      { key: "minha-empresa-acessos",   Icon: KeyRound,  grad: "empresa",       label: "Usuários",    desc: "Logins, acesso e mesclagem" },
      { key: "setores",                 Icon: Tag,       grad: "setores",       label: "Setores",     desc: "Times, acesso e permissões" },
      { key: "atendimento",             Icon: Clock,     grad: "atendimento",   label: "Atendimento", desc: "SLA, fila e regras de inbox" },
      { key: "gamificacao",             Icon: Trophy,    grad: "gamificacao",   label: "Gamificação", desc: "Regras de pontos e ranking" },
      { key: "email",                   Icon: Mail,      grad: "email",         label: "E-mail (SMTP)", desc: "Servidor de e-mail" },
      { key: "minha-empresa-cofre",     Icon: Shield,    grad: "cofre",         label: "Cofre",       desc: "Senhas e credenciais" },
      { key: "minha-empresa-plano",     Icon: CreditCard,grad: "oportunidades", label: "Plano atual", desc: "Assinatura e mudança de plano" },
    ],
  },
  {
    type: "group",
    key: "integracoes",
    Icon: Plug,
    grad: "integracoes",
    label: "Integrações",
    children: [
      { key: "integracoes-google",    Icon: Globe,      grad: "google",    label: "Google",          desc: "Analytics, Search Console, Meu Negócio" },
      { key: "integracoes-evolution", Icon: Zap,        grad: "evolution", label: "Evolution API",   desc: "WhatsApp gateway" },
      { key: "integracoes-clickup",   Icon: CheckSquare,grad: "clickup",   label: "ClickUp",         desc: "Tarefas e projetos" },
      { key: "integracoes-openai",    Icon: Sparkles,   grad: "openai",    label: "OpenAI",          desc: "IA e automação" },
      { key: "integracoes-webhook",   Icon: Webhook,    grad: "webhook",   label: "Webhook de Leads",desc: "Receba leads de qualquer fonte" },
    ],
  },
  { type: "item", key: "pipeline",    Icon: Workflow, grad: "pipeline",    label: "CRM / Pipeline", desc: "Etapas e configurações" },
];

function isIntegSubKey(key: string) {
  return key.startsWith("integracoes-");
}
function isMinhaEmpresaSubKey(key: string) {
  // Inclui chaves que vivem visualmente em "Minha Empresa" mesmo sem prefixo
  return key.startsWith("minha-empresa-")
    || key === "setores"
    || key === "atendimento"
    || key === "gamificacao"
    || key === "email";
}

export default function SettingsLayout({
  activeSection,
  children,
}: {
  activeSection: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  // Estado de colapso por grupo. Inicia aberto se a seção ativa pertence
  // ao grupo (pra usuário não precisar abrir manualmente toda vez).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    "minha-empresa": !isMinhaEmpresaSubKey(activeSection),
    "integracoes":   !isIntegSubKey(activeSection),
  }));

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function goSection(key: string) {
    router.push(`/configuracoes?secao=${key}`);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Submenu lateral */}
      <div className="w-[220px] min-w-[220px] border-r border-[#1e2d45] flex flex-col py-4 px-2.5">
        <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-2 mb-3">
          Configurações
        </div>
        {SECTIONS.map((s) => {
          if (s.type === "item") {
            const active = activeSection === s.key;
            return (
              <button
                key={s.key}
                onClick={() => goSection(s.key)}
                className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg mb-0.5 transition-all ${
                  active ? "bg-indigo-500/15 border-l-2 border-indigo-500" : "hover:bg-[#161f30]"
                }`}
              >
                <s.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(s.grad)} />
                <div className="min-w-0">
                  <div className={`text-[13px] font-medium leading-tight ${active ? "text-white" : "text-slate-300"}`}>
                    {s.label}
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">{(s as any).desc}</div>
                </div>
              </button>
            );
          }

          // Group
          const groupActive = s.key === "integracoes"
            ? isIntegSubKey(activeSection)
            : s.key === "minha-empresa"
            ? isMinhaEmpresaSubKey(activeSection)
            : false;
          const isCollapsed = !!collapsed[s.key];
          return (
            <div key={s.key} className="mb-0.5">
              {/* Group header — clicável pra colapsar/expandir */}
              <button
                onClick={() => toggleGroup(s.key)}
                className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors ${groupActive ? "bg-[#161f30]" : "hover:bg-[#161f30]/60"}`}
              >
                <s.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(s.grad)} />
                <div className={`flex-1 text-[13px] font-medium leading-tight ${groupActive ? "text-slate-200" : "text-slate-400"}`}>
                  {s.label}
                </div>
                {isCollapsed
                  ? <ChevronRight className="w-3.5 h-3.5 text-slate-600" strokeWidth={2.5} />
                  : <ChevronDown  className="w-3.5 h-3.5 text-slate-500" strokeWidth={2.5} />}
              </button>
              {/* Sub-items — escondidos quando colapsado */}
              {!isCollapsed && (
              <div className="ml-4 border-l border-[#1e2d45] pl-2 mt-0.5 space-y-0.5">
                {s.children.map((c) => {
                  const childActive = activeSection === c.key;
                  return (
                    <button
                      key={c.key}
                      onClick={() => goSection(c.key)}
                      className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all ${
                        childActive ? "bg-indigo-500/15 border-l-2 border-indigo-500" : "hover:bg-[#161f30]"
                      }`}
                    >
                      <c.Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(c.grad)} />
                      <div className="min-w-0">
                        <div className={`text-[12px] font-medium leading-tight ${childActive ? "text-white" : "text-slate-300"}`}>
                          {c.label}
                        </div>
                        <div className="text-[10px] text-slate-600 truncate">{c.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Conteúdo da seção */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

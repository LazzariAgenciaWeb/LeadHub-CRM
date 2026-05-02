"use client";

import { useRouter } from "next/navigation";
import {
  MessageSquare, Building2, Plug, Zap, CheckSquare, Sparkles, Webhook,
  Workflow, Tag, Clock, Globe, Mail, type LucideIcon,
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
  { type: "item", key: "empresa",    Icon: Building2,     grad: "empresa",    label: "Empresa",              desc: "Dados e perfil" },
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
  { type: "item", key: "setores",     Icon: Tag,      grad: "setores",     label: "Setores",        desc: "Times, acesso e permissões" },
  { type: "item", key: "atendimento", Icon: Clock,    grad: "atendimento", label: "Atendimento",    desc: "SLA, fila e regras de inbox" },
  { type: "item", key: "email",       Icon: Mail,     grad: "email",       label: "E-mail (SMTP)",  desc: "Servidor de e-mail do sistema" },
];

function isIntegSubKey(key: string) {
  return key.startsWith("integracoes-");
}

export default function SettingsLayout({
  activeSection,
  children,
}: {
  activeSection: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

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
          const groupActive = isIntegSubKey(activeSection);
          return (
            <div key={s.key} className="mb-0.5">
              {/* Group header — not clickable, just a label */}
              <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${groupActive ? "bg-[#161f30]" : ""}`}>
                <s.Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2.25} stroke={gradStroke(s.grad)} />
                <div className={`text-[13px] font-medium leading-tight ${groupActive ? "text-slate-200" : "text-slate-400"}`}>
                  {s.label}
                </div>
              </div>
              {/* Sub-items */}
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

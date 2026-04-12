"use client";

import { useRouter, useSearchParams } from "next/navigation";

const SECTIONS = [
  { key: "instancias", icon: "💬", label: "Instâncias WhatsApp", desc: "Números conectados" },
  { key: "empresa", icon: "🏢", label: "Empresa", desc: "Dados e perfil" },
  { key: "integracoes", icon: "⚡", label: "Integrações", desc: "Evolution API e outros" },
  { key: "pipeline", icon: "🫧", label: "CRM / Pipeline", desc: "Etapas e configurações" },
];

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
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => goSection(s.key)}
            className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg mb-0.5 transition-all ${
              activeSection === s.key
                ? "bg-indigo-500/15 border-l-2 border-indigo-500"
                : "hover:bg-[#161f30]"
            }`}
          >
            <span className="text-[16px] w-5 text-center flex-shrink-0">{s.icon}</span>
            <div className="min-w-0">
              <div className={`text-[13px] font-medium leading-tight ${activeSection === s.key ? "text-indigo-400" : "text-slate-300"}`}>
                {s.label}
              </div>
              <div className="text-[10px] text-slate-600 truncate">{s.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Conteúdo da seção */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

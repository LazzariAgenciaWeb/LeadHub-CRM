"use client";

import { useRouter } from "next/navigation";

type SectionItem =
  | { type: "item"; key: string; icon: string; label: string; desc: string }
  | { type: "group"; label: string; icon: string; key: string; children: { key: string; icon: string; label: string; desc: string }[] };

const SECTIONS: SectionItem[] = [
  { type: "item", key: "instancias", icon: "💬", label: "Instâncias WhatsApp", desc: "Números conectados" },
  { type: "item", key: "empresa", icon: "🏢", label: "Empresa", desc: "Dados e perfil" },
  {
    type: "group",
    key: "integracoes",
    icon: "🔌",
    label: "Integrações",
    children: [
      { key: "integracoes-evolution", icon: "⚡", label: "Evolution API", desc: "WhatsApp gateway" },
      { key: "integracoes-clickup", icon: "✅", label: "ClickUp", desc: "Tarefas e projetos" },
    ],
  },
  { type: "item", key: "pipeline", icon: "🫧", label: "CRM / Pipeline", desc: "Etapas e configurações" },
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
                <span className="text-[16px] w-5 text-center flex-shrink-0">{s.icon}</span>
                <div className="min-w-0">
                  <div className={`text-[13px] font-medium leading-tight ${active ? "text-indigo-400" : "text-slate-300"}`}>
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
                <span className="text-[16px] w-5 text-center flex-shrink-0">{s.icon}</span>
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
                      <span className="text-[14px] w-4 text-center flex-shrink-0">{c.icon}</span>
                      <div className="min-w-0">
                        <div className={`text-[12px] font-medium leading-tight ${childActive ? "text-indigo-400" : "text-slate-300"}`}>
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

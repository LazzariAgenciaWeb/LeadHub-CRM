"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Botão "Sync todos" — chama /api/projetos/sync-all e refaz a página. */
export default function SyncAllButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState<string | null>(null);

  async function syncAll() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/projetos/sync-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`❌ ${data?.error ?? "erro"}`);
        return;
      }
      const a = data.activities ?? {};
      setMsg(
        `✅ ${data.synced}/${data.total} projetos · ` +
        `${a.created ?? 0} criadas · ${a.updated ?? 0} atualizadas · ${a.completed ?? 0} concluídas` +
        (data.errors ? ` · ${data.errors} erros` : ""),
      );
      router.refresh();
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
      // Limpa msg depois de 8s
      setTimeout(() => setMsg(null), 8000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span className="text-xs text-slate-400">{msg}</span>
      )}
      <button
        onClick={syncAll}
        disabled={loading}
        className="px-3 py-2 rounded-lg border border-slate-700 bg-[#0a0f1a] hover:bg-[#161f30] text-slate-300 hover:text-white text-xs font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
        title="Sincroniza contadores, atividades e pontuação de todos os projetos com o ClickUp"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Sincronizando..." : "Sync todos"}
      </button>
    </div>
  );
}

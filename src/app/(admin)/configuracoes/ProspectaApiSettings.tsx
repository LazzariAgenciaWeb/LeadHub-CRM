"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Configuração da SerpAPI key da empresa atual. Cada cliente traz a
// própria conta SerpAPI (https://serpapi.com). Salva em Company.serpapiKey
// via PATCH /api/companies/[id]. Só fica acessível se o módulo "Prospecção
// via SerpAPI" estiver ligado pra empresa.
export default function ProspectaApiSettings({
  companyId,
  initialKey,
}: {
  companyId: string;
  initialKey: string;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState(initialKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; info?: string; error?: string } | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serpapiKey: apiKey.trim() || null }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message ?? "Erro ao salvar" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const url = new URL("https://serpapi.com/account");
      url.searchParams.set("api_key", apiKey.trim());
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        const left = data?.searches_left ?? data?.plan_searches_left ?? null;
        const plan = data?.plan_name ?? "plano desconhecido";
        setTestResult({
          ok: true,
          info: `Conectado — ${plan}${left != null ? ` · ${left} buscas restantes no mês` : ""}`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setTestResult({
          ok: false,
          error: err?.error ?? `Erro ${res.status}: chave inválida ou sem permissão`,
        });
      }
    } catch {
      setTestResult({ ok: false, error: "Falha na conexão com SerpAPI" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-white font-bold text-xl mb-1">Prospecta IA · SerpAPI</h2>
      <p className="text-slate-400 text-sm mb-6">
        Configure a chave da sua conta SerpAPI pra habilitar a busca de prospects no Google Maps em <em>CRM → Prospecção → Buscar prospects</em>.
        Crie sua conta gratuita em{" "}
        <a href="https://serpapi.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
          serpapi.com
        </a>{" "}
        e cole a API key abaixo.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
            SerpAPI API Key
          </label>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cole aqui a API key (encontrada em serpapi.com → dashboard)"
            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            autoComplete="off"
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            Cada empresa usa a própria conta SerpAPI. Sem chave configurada, o botão "Buscar prospects" não aparece.
          </p>
        </div>

        {testResult && (
          <div
            className={`text-sm rounded-lg px-3 py-2 border ${
              testResult.ok
                ? "bg-emerald-950/40 border-emerald-900 text-emerald-300"
                : "bg-red-950/40 border-red-900 text-red-300"
            }`}
          >
            {testResult.ok ? "✅" : "⚠️"} {testResult.info ?? testResult.error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving ? "Salvando..." : saved ? "✓ Salvo" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="px-4 py-2 rounded-lg bg-[#1e2d45] hover:bg-[#2a3a55] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testing ? "Testando..." : "Testar conexão"}
          </button>
        </div>
      </form>
    </div>
  );
}

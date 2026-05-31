"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Configuração da chave do LeadHub Prospecta. Cada cliente cria a própria conta
// no provedor de busca e cola a chave aqui. Salva em Company.serpapiKey via
// PATCH /api/companies/[id]. Só fica acessível se o módulo estiver ligado.
//
// Marca: pro usuário o produto é "LeadHub Prospecta". O nome do provedor
// (SerpAPI) só aparece no passo a passo abaixo porque é onde o cliente
// efetivamente cria a conta — em nenhum outro ponto do produto ele aparece.

// Quando o vídeo tutorial estiver pronto, cole aqui o link de embed
// (YouTube: https://www.youtube.com/embed/XXXX · Loom: https://www.loom.com/embed/XXXX).
// Vazio = mostra um placeholder "em breve".
const TUTORIAL_VIDEO_URL = "";

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
        const plan = data?.plan_name ?? "plano gratuito";
        setTestResult({
          ok: true,
          info: `Conectado — ${plan}${left != null ? ` · ${left} buscas restantes neste mês` : ""}`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setTestResult({
          ok: false,
          error: err?.error ?? `Erro ${res.status}: chave inválida ou sem permissão`,
        });
      }
    } catch {
      setTestResult({ ok: false, error: "Não foi possível validar a chave. Confira se copiou ela inteira." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-white font-bold text-xl mb-1">🎯 LeadHub Prospecta</h2>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        Encontre empresas novas direto no Google Maps e traga e-mail, Instagram e
        Facebook já preenchidos pro seu CRM, em <em>Prospecção → Buscar prospects</em>.
        Pra ativar, você conecta uma chave gratuita em 2 minutos — siga o passo a passo abaixo.
      </p>

      {/* Vídeo tutorial */}
      <div className="mb-6">
        <h3 className="text-white font-semibold text-sm mb-2">📺 Veja como ativar (vídeo de 2 min)</h3>
        {TUTORIAL_VIDEO_URL ? (
          <div className="relative w-full rounded-xl overflow-hidden border border-[#1e2d45]" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={TUTORIAL_VIDEO_URL}
              title="Como ativar o LeadHub Prospecta"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        ) : (
          <div
            className="w-full rounded-xl border border-dashed border-[#2a3a55] bg-[#0f1623] flex flex-col items-center justify-center text-center px-4"
            style={{ aspectRatio: "16 / 9" }}
          >
            <span className="text-3xl mb-2">🎬</span>
            <p className="text-slate-400 text-sm font-medium">Vídeo tutorial em breve</p>
            <p className="text-slate-600 text-xs mt-1">Enquanto isso, é só seguir os 4 passos abaixo.</p>
          </div>
        )}
      </div>

      {/* Passo a passo */}
      <div className="mb-6 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">Como pegar sua chave em 4 passos</h3>
        <ol className="space-y-3">
          {[
            <>
              Crie sua conta gratuita em{" "}
              <a href="https://serpapi.com/users/sign_up" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-medium">
                serpapi.com
              </a>{" "}
              — o plano grátis dá <strong className="text-slate-200">100 buscas por mês</strong>, sem precisar de cartão.
            </>,
            <>Confirme seu e-mail e entre no painel da conta (menu <strong className="text-slate-200">Dashboard</strong>).</>,
            <>
              Copie a sua{" "}
              <a href="https://serpapi.com/manage-api-key" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-medium">
                Private API Key
              </a>{" "}
              (uma sequência longa de letras e números).
            </>,
            <>Cole a chave no campo abaixo, clique em <strong className="text-slate-200">Salvar</strong> e depois em <strong className="text-slate-200">Testar conexão</strong> pra confirmar.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-300 leading-relaxed">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-[#1e2d45]">
          💡 Cada "Buscar prospects" usa 1 das suas buscas do mês. O enriquecimento de
          e-mail, Instagram e Facebook é por nossa conta — não desconta nada.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
            Sua chave do LeadHub Prospecta
          </label>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cole aqui a chave que você copiou no passo 3"
            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            autoComplete="off"
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            Sem chave configurada, o botão "Buscar prospects" não aparece no CRM.
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

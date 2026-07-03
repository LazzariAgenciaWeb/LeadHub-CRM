"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Configuração da Meta Conversions API (CAPI) por empresa. O cliente conecta o
// próprio Pixel + token CAPI (System User). Quando um lead entra numa etapa
// marcada como 🏆 Ganho (Configurações → CRM/Pipeline), o LeadHub avisa o Meta
// da venda pra otimizar as campanhas. O token é salvo cifrado (AES-256-GCM) e
// nunca volta pro navegador.

interface MetaCapiConfig {
  pixelId: string;
  testEventCode: string | null;
  eventName: string;
  currency: string;
  enabled: boolean;
  lastEventAt: string | null;
  lastStatus: string | null;
  hasToken: boolean;
}

interface MetaCapiLog {
  id: string;
  eventName: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  value: number | null;
  matchQuality: string | null;
  lastError: string | null;
  createdAt: string;
  leadId: string | null;
}

const STATUS_BADGE: Record<MetaCapiLog["status"], { label: string; cls: string }> = {
  SENT:    { label: "Enviado", cls: "text-emerald-300 bg-emerald-500/15" },
  PENDING: { label: "Na fila", cls: "text-amber-300 bg-amber-500/15" },
  FAILED:  { label: "Falhou",  cls: "text-red-300 bg-red-500/15" },
};

// Link de embed do vídeo tutorial (YouTube/Loom). Vazio = placeholder "em breve".
const TUTORIAL_VIDEO_URL = "";

export default function MetaCapiSettings({
  companyId,
  initialConfig,
  isSuperAdmin = false,
  logs = [],
}: {
  companyId: string;
  initialConfig: MetaCapiConfig | null;
  isSuperAdmin?: boolean;
  logs?: MetaCapiLog[];
}) {
  const router = useRouter();
  const [pixelId, setPixelId] = useState(initialConfig?.pixelId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [testEventCode, setTestEventCode] = useState(initialConfig?.testEventCode ?? "");
  const [currency, setCurrency] = useState(initialConfig?.currency ?? "BRL");
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? true);
  const hasToken = initialConfig?.hasToken ?? false;

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const withCompany = (extra: Record<string, unknown> = {}) =>
    isSuperAdmin ? { companyId, ...extra } : extra;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/meta-capi/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withCompany({
          pixelId: pixelId.trim(),
          // Só manda o token se o usuário digitou um novo (senão mantém o salvo).
          ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
          testEventCode: testEventCode.trim() || null,
          currency: currency.trim() || "BRL",
          enabled,
        })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao salvar");
      setSaved(true);
      setAccessToken("");
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? "Erro ao salvar" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/meta-capi/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withCompany()),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setMsg({
          ok: true,
          text: `Evento de teste aceito pelo Meta${data?.eventsReceived ? ` (${data.eventsReceived} recebido)` : ""}. Confira em Gerenciador de Eventos → Testar eventos.`,
        });
      } else {
        setMsg({ ok: false, text: data?.status ?? data?.error ?? "Falha ao enviar o evento de teste." });
      }
      router.refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? "Erro ao testar" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl p-6">
      <h2 className="text-white font-bold text-xl mb-1">📊 Meta · Conversões (Ads)</h2>
      <p className="text-slate-400 text-sm mb-6 leading-relaxed">
        Avise o Meta toda vez que um lead virar <strong className="text-slate-200">venda</strong> no CRM.
        Com isso, o Facebook/Instagram Ads passa a otimizar suas campanhas buscando gente
        parecida com quem <em>realmente comprou</em> — não só quem preencheu formulário.
        O disparo acontece quando o lead entra numa etapa marcada como{" "}
        <strong className="text-emerald-300">🏆 Ganho</strong> (você define isso em{" "}
        <button onClick={() => router.push("/configuracoes?secao=pipeline")} className="text-indigo-400 hover:underline">CRM / Pipeline</button>).
      </p>

      {/* Vídeo tutorial */}
      <div className="mb-6">
        <h3 className="text-white font-semibold text-sm mb-2">📺 Veja como conectar (vídeo)</h3>
        {TUTORIAL_VIDEO_URL ? (
          <div className="relative w-full rounded-xl overflow-hidden border border-[#1e2d45]" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={TUTORIAL_VIDEO_URL}
              title="Como conectar a Meta Conversions API"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        ) : (
          <div className="w-full rounded-xl border border-dashed border-[#2a3a55] bg-[#0f1623] flex flex-col items-center justify-center text-center px-4" style={{ aspectRatio: "16 / 9" }}>
            <span className="text-3xl mb-2">🎬</span>
            <p className="text-slate-400 text-sm font-medium">Vídeo tutorial em breve</p>
            <p className="text-slate-600 text-xs mt-1">Enquanto isso, siga os 5 passos abaixo.</p>
          </div>
        )}
      </div>

      {/* Passo a passo — gerar Pixel + token CAPI */}
      <div className="mb-6 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
        <h3 className="text-white font-semibold text-sm mb-3">Como pegar seu Pixel e o token em 5 passos</h3>
        <ol className="space-y-3">
          {[
            <>
              Abra o{" "}
              <a href="https://business.facebook.com/events_manager2/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-medium">
                Gerenciador de Eventos
              </a>{" "}
              da Meta e selecione (ou crie) a sua conta comercial.
            </>,
            <>
              Em <strong className="text-slate-200">Fontes de dados → Conectar fonte de dados → Web</strong>,
              crie um <strong className="text-slate-200">Pixel</strong> e dê um nome (ex: "Site da empresa").
              Copie o <strong className="text-slate-200">ID do Pixel</strong> — é o número que aparece embaixo do nome.
            </>,
            <>
              Abra o Pixel, vá em <strong className="text-slate-200">Configurações</strong> e desça até
              a seção <strong className="text-slate-200">API de Conversões</strong>. Clique em{" "}
              <strong className="text-slate-200">Gerar token de acesso</strong> e copie o token
              (uma sequência longa). Guarde bem — o Meta só mostra uma vez.
            </>,
            <>
              <span className="text-slate-400">(Opcional, recomendado no começo)</span> Na aba{" "}
              <strong className="text-slate-200">Testar eventos</strong> do Pixel, copie o código{" "}
              <strong className="text-slate-200">TEST#####</strong> e cole no campo "Código de teste" abaixo —
              assim os primeiros eventos aparecem só na aba de teste, sem afetar as campanhas.
            </>,
            <>
              Cole o <strong className="text-slate-200">ID do Pixel</strong> e o{" "}
              <strong className="text-slate-200">token</strong> nos campos abaixo, clique em{" "}
              <strong className="text-slate-200">Salvar</strong> e depois em{" "}
              <strong className="text-slate-200">Enviar evento de teste</strong>. Volte no Gerenciador de
              Eventos → <em>Testar eventos</em> pra ver o evento chegando.
            </>,
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
          🔒 Seu token fica criptografado no LeadHub e nunca é exibido de volta. Quando terminar
          os testes, apague o "Código de teste" pra os eventos contarem de verdade nas campanhas.
        </p>
      </div>

      {/* Formulário */}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
            ID do Pixel
          </label>
          <input
            type="text"
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value)}
            placeholder="ex: 123456789012345"
            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            autoComplete="off"
            inputMode="numeric"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
            Token da API de Conversões
          </label>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={hasToken ? "•••••••• (token salvo — deixe em branco pra manter)" : "cole o token gerado no passo 3"}
            className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            autoComplete="off"
          />
          {hasToken && (
            <p className="text-[11px] text-emerald-400/80 mt-1.5">✓ Token já configurado. Só preencha se quiser trocar.</p>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
              Código de teste <span className="text-slate-600 normal-case">(opcional)</span>
            </label>
            <input
              type="text"
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              placeholder="TEST12345"
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              autoComplete="off"
            />
          </div>
          <div className="w-28">
            <label className="text-xs text-slate-400 font-semibold uppercase tracking-wide block mb-1.5">
              Moeda
            </label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-slate-300 text-sm">Envio ativo (desligue pra pausar sem apagar a configuração)</span>
        </label>

        {msg && (
          <div className={`text-sm rounded-lg px-3 py-2 border ${msg.ok ? "bg-emerald-950/40 border-emerald-900 text-emerald-300" : "bg-red-950/40 border-red-900 text-red-300"}`}>
            {msg.ok ? "✅" : "⚠️"} {msg.text}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-60">
            {saving ? "Salvando..." : saved ? "✓ Salvo" : "Salvar"}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !hasToken}
            title={!hasToken ? "Salve o Pixel e o token primeiro" : "Envia um evento de teste pro Meta"}
            className="px-4 py-2 rounded-lg bg-[#1e2d45] hover:bg-[#2a3a55] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testing ? "Enviando..." : "Enviar evento de teste"}
          </button>
        </div>
      </form>

      {/* Diagnóstico — últimos eventos enviados */}
      <div className="mt-8 border-t border-[#1e2d45] pt-5">
        <h3 className="text-white font-semibold text-sm mb-1">Últimos eventos</h3>
        <p className="text-slate-500 text-xs mb-3">
          Cada venda/lead vira um evento aqui. Falhas de rede são reprocessadas automaticamente a cada poucos minutos.
        </p>

        {logs.length === 0 ? (
          <div className="text-slate-600 text-sm py-6 text-center border border-dashed border-[#1e2d45] rounded-xl">
            Nenhum evento ainda. Marque uma etapa como 🏆 Ganho e mova um lead pra ela — ou clique em "Enviar evento de teste".
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#1e2d45]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left border-b border-[#1e2d45] bg-[#0f1623]">
                  <th className="font-medium px-3 py-2">Quando</th>
                  <th className="font-medium px-3 py-2">Evento</th>
                  <th className="font-medium px-3 py-2">Status</th>
                  <th className="font-medium px-3 py-2">Match</th>
                  <th className="font-medium px-3 py-2">Valor</th>
                  <th className="font-medium px-3 py-2">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const badge = STATUS_BADGE[l.status];
                  return (
                    <tr key={l.id} className="border-b border-[#1e2d45]/60 last:border-0">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        {new Date(l.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {l.eventName}{l.leadId === null && <span className="text-slate-600"> (teste)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                        {l.attempts > 1 && <span className="text-slate-600 ml-1">×{l.attempts}</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {l.matchQuality === "website"
                          ? <span title="Com fbc/fbp — match forte">🎯 forte</span>
                          : <span title="Só e-mail/telefone">básico</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        {l.value != null ? l.value.toLocaleString("pt-BR", { style: "currency", currency: initialConfig?.currency ?? "BRL" }) : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-[220px] truncate" title={l.lastError ?? ""}>
                        {l.status === "FAILED" ? (l.lastError ?? "—") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

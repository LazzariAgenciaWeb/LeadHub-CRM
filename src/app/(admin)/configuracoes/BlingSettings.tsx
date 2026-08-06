"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  companyId: string;
  isSuperAdmin?: boolean;
  companies?: { id: string; name: string }[];
  configured: boolean; // servidor tem BLING_CLIENT_ID/SECRET
  redirectUri: string; // URI que o Diego cadastra no app do Bling
  status: "ACTIVE" | "EXPIRED" | "ERROR" | "DISCONNECTED" | null; // null = nunca conectou
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  lastClientsSynced: number;
  lastInvoicesSynced: number;
  flash?: { ok?: boolean; error?: string } | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE:       { label: "Conectado",   cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  EXPIRED:      { label: "Expirado",    cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  ERROR:        { label: "Com erro",    cls: "bg-red-500/10 text-red-300 border-red-500/30" },
  DISCONNECTED: { label: "Desconectado", cls: "bg-slate-500/10 text-slate-300 border-slate-500/30" },
};

export default function BlingSettings({
  companyId,
  isSuperAdmin = false,
  companies = [],
  configured,
  redirectUri,
  status,
  lastSyncAt,
  lastSyncStatus,
  lastError,
  lastClientsSynced,
  lastInvoicesSynced,
  flash,
}: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  const connected = status === "ACTIVE" || status === "ERROR";
  const meta = status ? STATUS_META[status] : null;

  function changeCompany(newId: string) {
    router.push(`/configuracoes?secao=integracoes-bling${newId ? `&companyId=${newId}` : ""}`);
  }

  // Seletor de empresa (SUPER_ADMIN). Reutilizado no topo e na tela de escolha.
  const companyPicker = isSuperAdmin && companies.length > 0 && (
    <div>
      <label className="block text-slate-400 text-[11px] font-semibold mb-1.5 uppercase tracking-wide">
        Empresa
      </label>
      <select
        value={companyId}
        onChange={(e) => changeCompany(e.target.value)}
        className="w-full max-w-md bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
      >
        <option value="">— selecione uma empresa —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );

  // SUPER_ADMIN ainda não escolheu a empresa → só mostra o seletor.
  if (isSuperAdmin && !companyId) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Bling · ERP</h2>
          <p className="text-slate-400 text-sm mt-1">
            Escolha a empresa que vai conectar o Bling (a <strong>AZZ</strong>).
          </p>
        </div>
        {companyPicker}
      </div>
    );
  }

  // Query string com o companyId — as rotas honram isso pro SUPER_ADMIN (que
  // não tem companyId de sessão). ADMIN cai no companyId da própria sessão.
  const cq = companyId ? `?companyId=${companyId}` : "";

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/api/integrations/bling/sync${cq}`, { method: "POST" });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? "Falha no sync");
      setResult(json);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const r = await fetch(`/api/integrations/bling/preview${cq}`, { method: "POST" });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? "Falha ao pré-visualizar");
      setPreview(json.plan);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar o Bling? Os vínculos e faturas já importados são mantidos.")) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/integrations/bling/disconnect${cq}`, { method: "POST" });
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          Bling · ERP
          {meta && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.cls}`}>
              {meta.label}
            </span>
          )}
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Espelha o cadastro de clientes (mão dupla) e traz boletos + NF emitidas pro
          financeiro. Só a AZZ conecta a própria conta Bling.
        </p>
      </div>

      {companyPicker}

      {flash?.ok && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl p-3 text-sm">
          ✅ Bling conectado com sucesso.
        </div>
      )}
      {flash?.error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">
          ❌ Falha ao conectar: {flash.error}
        </div>
      )}

      {!configured && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
          ⚠️ O servidor ainda não tem as credenciais do Bling. Defina{" "}
          <code className="bg-black/30 px-1 rounded">BLING_CLIENT_ID</code> e{" "}
          <code className="bg-black/30 px-1 rounded">BLING_CLIENT_SECRET</code> no{" "}
          <code className="bg-black/30 px-1 rounded">.env</code> e reinicie.
        </div>
      )}

      {/* Passo de cadastro do app no Bling */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-2">
        <p className="text-slate-300 text-sm font-medium">Redirect URI (cadastrar no app do Bling)</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[12px] text-slate-300 bg-black/30 px-3 py-2 rounded-lg break-all">
            {redirectUri}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(redirectUri);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="text-xs px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 whitespace-nowrap"
          >
            {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>
        <p className="text-slate-500 text-[11px]">
          No Bling: Cadastros → Configurações → API/Aplicativos → crie um app, cole esta URL como
          redirecionamento e gere o Client ID / Secret.
        </p>
      </div>

      {/* Status + última sincronização */}
      {status && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Última sincronização</span>
            <span className="text-slate-200">
              {lastSyncAt ? new Date(lastSyncAt).toLocaleString("pt-BR") : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Resultado</span>
            <span className="text-slate-200">{lastSyncStatus ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Clientes sincronizados</span>
            <span className="text-slate-200">{lastClientsSynced}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Faturas importadas</span>
            <span className="text-slate-200">{lastInvoicesSynced}</span>
          </div>
          {lastError && (
            <p className="text-red-300 text-[12px] pt-1 border-t border-slate-700/50 mt-2">{lastError}</p>
          )}
        </div>
      )}

      {/* Ações */}
      <div className="flex flex-wrap gap-3">
        {!connected ? (
          <a
            href={`/api/integrations/bling/connect${cq}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              configured
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-slate-700 text-slate-400 cursor-not-allowed pointer-events-none"
            }`}
          >
            {status === "EXPIRED" || status === "DISCONNECTED" ? "Reconectar Bling" : "Conectar Bling"}
          </a>
        ) : (
          <>
            <button
              onClick={handlePreview}
              disabled={previewing || syncing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-60"
            >
              {previewing ? "Analisando…" : "Pré-visualizar importação"}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing || previewing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
            >
              {syncing ? "Sincronizando…" : "Sincronizar agora"}
            </button>
            <a
              href={`/api/integrations/bling/connect${cq}`}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              Reconectar
            </a>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-60"
            >
              {disconnecting ? "Desconectando…" : "Desconectar"}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>
      )}
      {result && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-xl p-4 text-sm space-y-1">
          <p className="font-medium">Sincronização concluída</p>
          <p>
            Clientes: {result.clients?.createdHere ?? 0} criados aqui ·{" "}
            {result.clients?.linkedHere ?? 0} vinculados ·{" "}
            {result.clients?.createdInBling ?? 0} criados no Bling
          </p>
          <p>
            Financeiro: {result.finance?.boletos ?? 0} boletos ·{" "}
            {result.finance?.notas ?? 0} NF vinculadas ·{" "}
            {result.finance?.unmatched ?? 0} sem cliente
          </p>
        </div>
      )}

      {preview && (
        <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-xl p-4 text-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-indigo-200">Pré-visualização (nada foi gravado)</p>
            <span className="text-[11px] text-indigo-300/70">dry-run</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-slate-300">
            <PreviewStat label="Criar aqui (novos)" value={preview.toCreateHere?.length ?? 0} tone="emerald" />
            <PreviewStat label="Vincular por CNPJ" value={preview.toLinkHere?.length ?? 0} tone="emerald" />
            <PreviewStat label="Criar no Bling" value={preview.toCreateInBling?.length ?? 0} tone="emerald" />
            <PreviewStat label="Já vinculados" value={preview.alreadyLinked ?? 0} tone="slate" />
            <PreviewStat label="Sem CNPJ (pulados)" value={preview.skippedNoDoc?.length ?? 0} tone="amber" />
            <PreviewStat label="Contatos não-cliente" value={preview.nonClientContacts ?? 0} tone="slate" />
          </div>

          {preview.toLinkHere?.length > 0 && (
            <PreviewList
              title={`Vão ser vinculados por CNPJ (${preview.toLinkHere.length})`}
              items={preview.toLinkHere.map((x: any) => x.companyName)}
            />
          )}
          {preview.toCreateHere?.length > 0 && (
            <PreviewList
              title={`Novos clientes vindos do Bling (${preview.toCreateHere.length})`}
              items={preview.toCreateHere.map((x: any) => x.nome)}
            />
          )}
          {preview.toCreateInBling?.length > 0 && (
            <PreviewList
              title={`Serão criados no Bling (${preview.toCreateInBling.length})`}
              items={preview.toCreateInBling.map((x: any) => x.companyName)}
            />
          )}
          {preview.skippedNoDoc?.length > 0 && (
            <PreviewList
              title={`Pulados por falta de CNPJ (${preview.skippedNoDoc.length})`}
              items={preview.skippedNoDoc.map((x: any) => x.companyName)}
            />
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
          >
            {syncing ? "Sincronizando…" : "Confirmar e sincronizar"}
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewStat({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "slate" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-slate-300";
  return (
    <div className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
      <span className="text-slate-400 text-[12px]">{label}</span>
      <span className={`font-semibold ${toneCls}`}>{value}</span>
    </div>
  );
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  const shown = items.slice(0, 10);
  return (
    <details className="bg-black/20 rounded-lg px-3 py-2">
      <summary className="cursor-pointer text-slate-300 text-[12px] font-medium">{title}</summary>
      <ul className="mt-2 space-y-0.5 text-slate-400 text-[12px]">
        {shown.map((it, i) => (
          <li key={i} className="truncate">• {it || "(sem nome)"}</li>
        ))}
        {items.length > shown.length && <li className="text-slate-500">… e mais {items.length - shown.length}</li>}
      </ul>
    </details>
  );
}

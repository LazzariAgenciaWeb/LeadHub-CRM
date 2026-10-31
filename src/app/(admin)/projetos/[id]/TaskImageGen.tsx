"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";

// Gerar imagem por IA dentro da tarefa de arte. A imagem pronta é anexada na
// tarefa pelo servidor (vai pro MinIO e, se a tarefa estiver espelhada, pro
// ClickUp) — aqui só mostramos o resultado e avisamos o painel de Arquivos
// pra recarregar.
//
// O catálogo de modelos vem do servidor (GET da própria rota): ele sabe quais
// provedores têm chave salva e se o storage está de pé.

type ModelInfo = {
  id: string;
  label: string;
  desc: string;
  provider: "freepik" | "openai";
  maxImages: number;
  mode: "sync" | "task";
};

type Catalog = {
  models: ModelInfo[];
  ratios: { value: string; label: string }[];
  providers: { freepik: boolean; openai: boolean };
  storageOff: boolean;
};

type Result = { key: string; url: string; fileName: string | null; attached: boolean };

const PROVIDER_LABEL: Record<ModelInfo["provider"], string> = {
  freepik: "Freepik",
  openai: "OpenAI",
};

const POLL_MS = 2500;
const POLL_MAX = 60; // ~2min30 — Mystic/Nano Banana em 2K levam bem menos

export default function TaskImageGen({
  projectId,
  taskId,
  onAttached,
}: {
  projectId: string;
  taskId: string;
  /** Imagem anexada: recarrega o painel de Arquivos e o feed da tarefa. */
  onAttached?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [ratio, setRatio] = useState("4:5");
  const [numImages, setNumImages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const alive = useRef(true);
  const base = `/api/projetos/${projectId}/tasks/${taskId}/gerar-imagem`;

  useEffect(() => () => { alive.current = false; }, []);

  // Catálogo só quando o painel abre — não gasta chamada em tarefa que ninguém
  // vai gerar arte.
  useEffect(() => {
    if (!open || catalog) return;
    (async () => {
      const res = await fetch(base).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (!alive.current || !data?.models) return;
      setCatalog(data);
      // Primeiro modelo de um provedor que tenha chave.
      const usable = data.models.find((m: ModelInfo) => data.providers[m.provider]);
      setModel(usable?.id ?? data.models[0]?.id ?? "");
    })();
  }, [open, catalog, base]);

  const current = catalog?.models.find((m) => m.id === model) ?? null;
  const maxImages = current?.maxImages ?? 1;
  const anyProvider = !!catalog && (catalog.providers.freepik || catalog.providers.openai);
  const providerOff = !!current && !!catalog && !catalog.providers[current.provider];

  function applyDone(data: any) {
    const files: Result[] = (data.files ?? []).map((f: any) => ({
      key: f.id, url: `/api/storage/${f.id}`, fileName: f.fileName, attached: true,
    }));
    const previews: Result[] = (data.previews ?? []).map((p: any, i: number) => ({
      key: `preview-${Date.now()}-${i}`, url: p.dataUrl, fileName: null, attached: false,
    }));
    setResults([...files, ...previews]);
    if (data.storageOff) {
      setNote("Imagem gerada, mas NÃO anexada: o armazenamento de arquivos (MinIO) ainda não está configurado neste ambiente. Clique na miniatura pra abrir e salvar.");
    } else {
      setNote(null);
      if (files.length) onAttached?.();
    }
  }

  async function poll(genTaskId: string): Promise<void> {
    const qs = new URLSearchParams({ taskId: genTaskId, model, prompt });
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive.current) return;
      setWaited((w) => w + POLL_MS / 1000);
      const res = await fetch(`${base}?${qs}`).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (!alive.current) return;
      if (!res || !data) { setError("Falha ao consultar a geração"); return; }
      if (!res.ok) { setError(data.error ?? "Falha ao gerar a imagem"); return; }
      if (data.pending) continue;
      applyDone(data);
      return;
    }
    setError("A geração passou do tempo. Veja no painel do provedor se a imagem saiu.");
  }

  async function generate() {
    if (prompt.trim().length < 3 || busy || !model) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setResults([]);
    setWaited(0);

    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim(), model, ratio, numImages }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);

    if (!alive.current) return;
    if (!res || !data) { setError("Falha ao falar com o servidor"); setBusy(false); return; }
    if (!res.ok) { setError(data.error ?? "Falha ao gerar a imagem"); setBusy(false); return; }

    if (data.pending) await poll(data.taskId);
    else applyDone(data);

    if (alive.current) setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-indigo-300 transition-colors"
      >
        <Sparkles className="w-3 h-3" /> Gerar imagem com IA
      </button>
    );
  }

  const byProvider = (["freepik", "openai"] as const).map((p) => ({
    provider: p,
    models: catalog?.models.filter((m) => m.provider === p) ?? [],
  }));

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-indigo-400" /> Gerar imagem com IA
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-300 text-xs">
          Fechar
        </button>
      </div>

      {!catalog ? (
        <p className="text-[11px] text-slate-600">Carregando modelos…</p>
      ) : !anyProvider ? (
        <p className="text-[11px] text-amber-200/90">
          Nenhuma chave de geração de imagem salva. Configure em Configurações → Integrações → Inteligência Artificial
          (Freepik ou OpenAI).
        </p>
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={busy}
            placeholder="Descreva a arte: o que aparece, estilo, cores, clima. Ex.: pizzaria artesanal, pizza saindo do forno a lenha, fundo escuro, luz quente, foto de close"
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-y disabled:opacity-60"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Modelo</label>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  const next = catalog.models.find((m) => m.id === e.target.value);
                  if (next && numImages > next.maxImages) setNumImages(1);
                }}
                disabled={busy}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60"
              >
                {byProvider.map(({ provider, models }) => models.length > 0 && (
                  <optgroup
                    key={provider}
                    label={catalog.providers[provider] ? PROVIDER_LABEL[provider] : `${PROVIDER_LABEL[provider]} (sem chave)`}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} disabled={!catalog.providers[provider]}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {current && <p className="text-slate-600 text-[10px] mt-1">{current.desc}</p>}
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Proporção</label>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                disabled={busy}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60"
              >
                {catalog.ratios.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {maxImages > 1 && (
                <div className="mt-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Quantas</label>
                  <select
                    value={numImages}
                    onChange={(e) => setNumImages(Number(e.target.value))}
                    disabled={busy}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60"
                  >
                    {Array.from({ length: maxImages }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={busy || providerOff || prompt.trim().length < 3}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {busy ? "Gerando…" : "Gerar imagem"}
            </button>
            {busy && (
              <span className="text-[10px] text-slate-500">
                {waited > 0 ? `${Math.round(waited)}s — a imagem entra em Arquivos quando ficar pronta` : "enviando…"}
              </span>
            )}
            {!busy && catalog.storageOff && (
              <span className="text-[10px] text-amber-200/70">storage desligado: a imagem não será anexada</span>
            )}
          </div>

          {providerOff && current && (
            <div className="text-[11px] px-3 py-2 rounded-lg border text-amber-200 bg-amber-500/10 border-amber-500/25">
              ⚠️ Sem chave do {PROVIDER_LABEL[current.provider]}. Escolha outro modelo ou configure a chave.
            </div>
          )}
        </>
      )}

      {error && (
        <div className="text-[11px] px-3 py-2 rounded-lg border text-red-400 bg-red-500/10 border-red-500/20">❌ {error}</div>
      )}
      {note && (
        <div className="text-[11px] px-3 py-2 rounded-lg border text-amber-200 bg-amber-500/10 border-amber-500/25">⚠️ {note}</div>
      )}

      {results.length > 0 && (
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
            {results[0].attached ? "Anexado na tarefa" : "Resultado (não anexado)"}
          </div>
          <div className="flex flex-wrap gap-2">
            {results.map((r) => (
              <a
                key={r.key}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-24 h-24 rounded-lg overflow-hidden border border-[#1e2d45] hover:border-indigo-500 transition-colors"
                title={r.fileName ?? "Abrir imagem"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.fileName ?? "Imagem gerada"} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

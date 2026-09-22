"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, Image as ImageIcon, Type, Trash2, ArrowUp, ArrowDown, X, CalendarClock } from "lucide-react";

type Compress = (file: File) => Promise<{ base64: string; mimeType: string; previewUrl: string; sizeKB: number }>;

type DraftItem =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "image"; base64: string; mimeType: string; previewUrl: string; caption: string };

const uid = () => Math.random().toString(36).slice(2, 10);

// datetime-local ⇄ Date no fuso do navegador
function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function atHour(base: Date, h: number) {
  const d = new Date(base);
  d.setHours(h, 0, 0, 0);
  return d;
}

const INTERVALS = [
  { v: 5, l: "5 s" }, { v: 10, l: "10 s" }, { v: 30, l: "30 s" },
  { v: 60, l: "1 min" }, { v: 120, l: "2 min" }, { v: 300, l: "5 min" },
];

/**
 * Modal de agendamento: monta uma SEQUÊNCIA (até 5) de textos e imagens que
 * saem em ordem na data/hora escolhida, com intervalo entre elas.
 * Pré-carrega o que já está no compositor (texto + imagem anexada).
 */
export function ScheduleMessageModal({
  open,
  onClose,
  instanceId,
  instanceLabel,
  phone,
  initialText,
  initialImage,
  signature,
  compressImage,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: string | null;
  instanceLabel: string;
  phone: string;
  initialText: string;
  initialImage: { base64: string; mimeType: string; previewUrl: string } | null;
  signature: string | null; // assinatura já resolvida (null = não assinar)
  compressImage: Compress;
  onScheduled: (count: number) => void;
}) {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [when, setWhen] = useState("");
  const [interval, setIntervalSec] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ao abrir: carrega o compositor como primeiro(s) item(ns)
  useEffect(() => {
    if (!open) return;
    const start: DraftItem[] = [];
    if (initialImage) {
      start.push({ id: uid(), kind: "image", ...initialImage, caption: initialText });
    } else {
      start.push({ id: uid(), kind: "text", text: initialText });
    }
    setItems(start);
    setWhen(toLocalInput(new Date(Date.now() + 60 * 60_000))); // padrão: daqui 1h
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const nextMonday = new Date(now); nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const quick = [
    { l: "Em 1h", d: new Date(now.getTime() + 60 * 60_000) },
    { l: "Amanhã 9h", d: atHour(tomorrow, 9) },
    { l: "Amanhã 14h", d: atHour(tomorrow, 14) },
    { l: "Segunda 9h", d: atHour(nextMonday, 9) },
  ];

  const update = (id: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...patch } as DraftItem) : it)));
  const remove = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  async function addImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Só imagens (jpg, png, webp)."); return; }
    try {
      const r = await compressImage(file);
      setItems((prev) => [...prev, { id: uid(), kind: "image", base64: r.base64, mimeType: r.mimeType, previewUrl: r.previewUrl, caption: "" }]);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao processar imagem.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    setError(null);
    if (!instanceId) { setError("Nenhuma instância conectada pra enviar."); return; }
    const sendAt = new Date(when);
    if (Number.isNaN(sendAt.getTime())) { setError("Escolha a data e a hora."); return; }
    if (sendAt.getTime() - Date.now() < 60_000) { setError("Escolha um horário pelo menos 1 minuto no futuro."); return; }

    // Assinatura vai no ÚLTIMO texto/legenda da sequência (igual ao envio normal)
    const payloadItems = items
      .map((it) => it.kind === "text"
        ? { text: it.text.trim() }
        : { text: it.caption.trim(), media: it.base64, mediaMimeType: it.mimeType })
      .filter((it: any) => it.text || it.media);
    if (payloadItems.length === 0) { setError("Adicione pelo menos um texto ou imagem."); return; }
    if (signature) {
      for (let i = payloadItems.length - 1; i >= 0; i--) {
        if (payloadItems[i].text) { payloadItems[i].text = `${payloadItems[i].text}\n\n-- _${signature}_`; break; }
      }
    }

    setSaving(true);
    const res = await fetch("/api/whatsapp/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, phone, sendAt: sendAt.toISOString(), intervalSeconds: interval, items: payloadItems }),
    });
    setSaving(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error ?? "Não consegui agendar."); return; }
    onScheduled(d.count ?? payloadItems.length);
    onClose();
  }

  const whenDate = new Date(when);
  const whenLabel = Number.isNaN(whenDate.getTime())
    ? ""
    : whenDate.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[88vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-400" strokeWidth={2.5} />
            <span className="text-sm font-semibold text-white">Agendar mensagem</span>
            <span className="text-[11px] text-slate-500">via {instanceLabel}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {/* Sequência */}
          <div>
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-2">
              Mensagens {items.length > 1 ? `(saem nesta ordem)` : ""}
            </p>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={it.id} className="flex gap-2 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-2">
                  <div className="flex flex-col items-center gap-0.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-500">{idx + 1}</span>
                    {items.length > 1 && (
                      <>
                        <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-600 hover:text-white disabled:opacity-20"><ArrowUp className="w-3 h-3" /></button>
                        <button onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="text-slate-600 hover:text-white disabled:opacity-20"><ArrowDown className="w-3 h-3" /></button>
                      </>
                    )}
                  </div>
                  {it.kind === "text" ? (
                    <textarea
                      value={it.text}
                      onChange={(e) => update(it.id, { text: e.target.value })}
                      placeholder="Texto da mensagem…"
                      rows={3}
                      className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none resize-none"
                    />
                  ) : (
                    <div className="flex-1 flex gap-2 min-w-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.previewUrl} alt="" className="w-20 h-20 object-cover rounded-lg flex-shrink-0" />
                      <textarea
                        value={it.caption}
                        onChange={(e) => update(it.id, { caption: e.target.value })}
                        placeholder="Legenda (opcional)…"
                        rows={3}
                        className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none resize-none"
                      />
                    </div>
                  )}
                  {items.length > 1 && (
                    <button onClick={() => remove(it.id)} className="self-start text-slate-600 hover:text-rose-400 p-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
            </div>
            {items.length < 5 && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setItems((p) => [...p, { id: uid(), kind: "text", text: "" }])}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-[#1e2d45] hover:border-indigo-500/40"
                >
                  <Type className="w-3.5 h-3.5" /> + Texto
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-[#1e2d45] hover:border-indigo-500/40"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> + Imagem
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => addImage(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </div>

          {/* Data e hora */}
          <div>
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-2">Quando</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quick.map((q) => (
                <button
                  key={q.l}
                  onClick={() => setWhen(toLocalInput(q.d))}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500/40"
                >
                  {q.l}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={when}
              min={toLocalInput(new Date(Date.now() + 60_000))}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Intervalo — só com sequência */}
          {items.length > 1 && (
            <div>
              <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-2">Intervalo entre as mensagens</p>
              <div className="flex flex-wrap gap-1.5">
                {INTERVALS.map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setIntervalSec(o.v)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      interval === o.v ? "bg-indigo-600 border-indigo-500 text-white" : "border-[#1e2d45] text-slate-400 hover:text-white"
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {signature && <p className="text-[11px] text-slate-500">Assinatura "{signature}" vai no último texto.</p>}
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-[#1e2d45] flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 truncate">{whenLabel && `Envio: ${whenLabel}`}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">Cancelar</button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" /> {saving ? "Agendando…" : items.length > 1 ? `Agendar ${items.length} mensagens` : "Agendar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ScheduledRow = {
  id: string; body: string; hasImage: boolean; sendAt: string; status: string;
  lastError: string | null; createdByName: string | null;
};

/**
 * Faixa acima do compositor: "🕐 N agendadas" (expansível), com cancelar.
 * Falhas aparecem em vermelho com o motivo. Recarrega quando `reloadKey` muda.
 */
export function ScheduledList({ phone, companyId, reloadKey }: { phone: string; companyId?: string; reloadKey: number }) {
  const [rows, setRows] = useState<ScheduledRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ phone });
    if (companyId) params.set("companyId", companyId);
    const res = await fetch(`/api/whatsapp/scheduled?${params}`);
    if (res.ok) setRows((await res.json()).scheduled ?? []);
  }, [phone, companyId]);

  useEffect(() => { void load(); }, [load, reloadKey]);
  // Atualiza sozinho enquanto houver pendentes (pra ver saindo/falhando)
  useEffect(() => {
    if (rows.length === 0) return;
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [rows.length, load]);

  async function cancel(id: string) {
    const res = await fetch(`/api/whatsapp/scheduled/${id}`, { method: "DELETE" });
    if (res.ok) setRows((p) => p.filter((r) => r.id !== id));
    else alert((await res.json().catch(() => ({}))).error ?? "Não consegui cancelar.");
  }

  if (rows.length === 0) return null;
  const failed = rows.filter((r) => r.status === "FAILED").length;

  return (
    <div className="mb-2 rounded-lg border border-indigo-500/25 bg-indigo-500/5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-indigo-200">
        <Clock className="w-3.5 h-3.5 text-indigo-400" strokeWidth={2.5} />
        <span className="font-medium">{rows.length} mensagem{rows.length > 1 ? "s" : ""} agendada{rows.length > 1 ? "s" : ""}</span>
        {failed > 0 && <span className="text-rose-400 font-semibold">· {failed} com falha</span>}
        <span className="ml-auto text-indigo-400/70">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1">
          {rows.map((r) => (
            <div key={r.id} className={`flex items-start gap-2 px-2 py-1.5 rounded-md ${r.status === "FAILED" ? "bg-rose-500/10" : "bg-[#0f1623]"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500">
                  {new Date(r.sendAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {r.createdByName ? ` · ${r.createdByName.split(" ")[0]}` : ""}
                  {r.status === "SENDING" ? " · enviando…" : ""}
                </p>
                <p className="text-xs text-slate-200 truncate">{r.hasImage ? "🖼️ " : ""}{r.body || (r.hasImage ? "Imagem" : "")}</p>
                {r.status === "FAILED" && <p className="text-[10px] text-rose-400 truncate" title={r.lastError ?? ""}>Falhou: {r.lastError}</p>}
              </div>
              {r.status !== "SENDING" && (
                <button onClick={() => cancel(r.id)} className="text-[11px] text-slate-500 hover:text-rose-400 flex-shrink-0 px-1" title={r.status === "FAILED" ? "Remover" : "Cancelar envio"}>
                  {r.status === "FAILED" ? "Remover" : "Cancelar"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

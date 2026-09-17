"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, Send } from "lucide-react";

const MAX_SECONDS = 5 * 60; // limite de gravação (5 min)

// Formato preferido por navegador. A Evolution (encoding:true) converte qualquer
// um pra voz do WhatsApp, então basta o navegador conseguir gravar.
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+(;[^,]*)?,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Gravador de mensagem de voz do compositor.
 * idle → 🎤 · recording → barra com timer (cancelar / parar / enviar direto)
 * · preview → player + descartar / enviar.
 * A barra ativa cobre a linha do compositor (o <form> pai é `relative`).
 */
export default function AudioRecorder({
  disabled,
  onSend,
  onError,
}: {
  disabled?: boolean;
  onSend: (base64: string, mimeType: string) => Promise<boolean>;
  onError: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "preview">("idle");
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Quando parar deve enviar direto (botão ➤ durante a gravação)
  const sendOnStopRef = useRef(false);
  const cancelledRef = useRef(false);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function reset() {
    releaseStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    blobRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
    setState("idle");
  }

  // Libera o microfone se o componente sair da tela (troca de conversa etc.)
  useEffect(() => () => {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* já parado */ }
    releaseStream();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(blob: Blob) {
    setSending(true);
    try {
      const base64 = await blobToBase64(blob);
      const ok = await onSend(base64, blob.type || "audio/webm");
      if (ok) reset();
      else setState("preview");
    } catch {
      onError("Falha ao preparar o áudio para envio.");
      setState("preview");
    } finally {
      setSending(false);
    }
  }

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Seu navegador não suporta gravação de áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      cancelledRef.current = false;
      sendOnStopRef.current = false;

      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        releaseStream();
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
        if (blob.size === 0) { reset(); onError("Nenhum áudio foi capturado."); return; }
        blobRef.current = blob;
        if (sendOnStopRef.current) {
          void send(blob);
        } else {
          setPreviewUrl(URL.createObjectURL(blob));
          setState("preview");
        }
      };

      rec.start(250);
      setSeconds(0);
      setState("recording");
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) { try { rec.stop(); } catch { /* noop */ } }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      releaseStream();
      onError(
        err?.name === "NotAllowedError"
          ? "Permissão de microfone negada. Libere o microfone para este site no navegador."
          : "Não foi possível acessar o microfone.",
      );
    }
  }

  function stop(sendNow = false) {
    sendOnStopRef.current = sendNow;
    try { recorderRef.current?.stop(); } catch { /* noop */ }
  }

  function cancel() {
    cancelledRef.current = true;
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    reset();
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        title="Gravar mensagem de voz"
        className="px-3 rounded-xl bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500/40 disabled:opacity-40 transition-colors flex-shrink-0 flex items-center justify-center"
        style={{ height: "42px" }}
      >
        <Mic className="w-4 h-4" strokeWidth={2.5} />
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center gap-2 bg-[#0b1120] rounded-xl">
      <button
        type="button"
        onClick={cancel}
        disabled={sending}
        title="Descartar"
        className="px-3 rounded-xl bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-rose-400 hover:border-rose-500/40 disabled:opacity-40 transition-colors flex-shrink-0 flex items-center justify-center"
        style={{ height: "42px" }}
      >
        <Trash2 className="w-4 h-4" strokeWidth={2.5} />
      </button>

      {state === "recording" ? (
        <div className="flex-1 flex items-center gap-3 bg-[#0f1623] border border-rose-500/30 rounded-xl px-4" style={{ height: "42px" }}>
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
          <span className="text-sm text-rose-300 font-medium tabular-nums">{fmt(seconds)}</span>
          <span className="text-xs text-slate-500 truncate">Gravando… (máx. {fmt(MAX_SECONDS)})</span>
          <button
            type="button"
            onClick={() => stop(false)}
            title="Parar e ouvir antes de enviar"
            className="ml-auto flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5"
          >
            <Square className="w-3.5 h-3.5 fill-current" strokeWidth={2.5} /> Parar
          </button>
        </div>
      ) : (
        <div className="flex-1 flex items-center bg-[#0f1623] border border-[#1e2d45] rounded-xl px-2 min-w-0" style={{ height: "42px" }}>
          {previewUrl && <audio src={previewUrl} controls className="w-full h-8" />}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (state === "recording") stop(true);
          else if (blobRef.current) void send(blobRef.current);
        }}
        disabled={sending}
        title="Enviar áudio"
        className="px-4 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors flex-shrink-0 flex items-center justify-center"
        style={{ height: "42px" }}
      >
        {sending ? <span className="text-sm">...</span> : <Send className="w-4 h-4" strokeWidth={2.5} />}
      </button>
    </div>
  );
}

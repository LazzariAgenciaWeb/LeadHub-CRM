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
  // Pedindo permissão / erro visível ao lado do botão (antes falhava em silêncio)
  const [requesting, setRequesting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

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

  // Mostra o problema no próprio botão (balão acima dele) E no aviso do compositor.
  function fail(msg: string, err?: any) {
    if (err) console.error("[AudioRecorder]", err?.name, err?.message, err);
    setRequesting(false);
    setLocalError(msg);
    onError(msg);
  }

  async function start() {
    setLocalError(null);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      fail("Gravação exige conexão segura (https).");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      fail("Seu navegador não suporta gravação de áudio. Use Chrome, Edge, Firefox ou Safari atualizado.");
      return;
    }

    // Permissão já bloqueada pro site → o navegador recusa SEM mostrar pedido.
    // Avisa antes, com o caminho pra liberar.
    try {
      const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (perm?.state === "denied") {
        fail("Microfone bloqueado para este site. Clique no cadeado 🔒 ao lado do endereço → Microfone → Permitir, e recarregue a página.");
        return;
      }
    } catch { /* Safari/Firefox antigos não suportam query de microfone — segue */ }

    setRequesting(true);
    // Se o pedido de permissão não aparecer/ficar pendente, orienta o usuário.
    const hint = setTimeout(() => {
      setLocalError("Aguardando permissão do microfone… procure o aviso/ícone 🎤 na barra de endereço e clique em Permitir.");
    }, 5000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      clearTimeout(hint);
      setRequesting(false);
      setLocalError(null);
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
      clearTimeout(hint);
      releaseStream();
      const name = err?.name ?? "";
      const byMacOS = /system/i.test(err?.message ?? "");
      fail(
        name === "NotAllowedError" && byMacOS
          ? "O macOS está bloqueando o microfone do navegador. Abra Ajustes do Sistema → Privacidade e Segurança → Microfone, ative o seu navegador e reabra-o."
          : name === "NotAllowedError"
          ? "Permissão de microfone negada. Clique no cadeado 🔒 ao lado do endereço → Microfone → Permitir, e tente de novo."
          : name === "NotFoundError"
          ? "Nenhum microfone encontrado neste computador."
          : name === "NotReadableError"
          ? "O microfone está em uso por outro aplicativo (Meet, Zoom, WhatsApp…). Feche-o e tente de novo."
          : `Não foi possível acessar o microfone (${name || "erro desconhecido"}).`,
        err,
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
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={start}
          disabled={disabled || requesting}
          title={requesting ? "Pedindo permissão do microfone…" : "Gravar mensagem de voz"}
          className={`px-3 rounded-xl border transition-colors flex items-center justify-center disabled:opacity-60 ${
            requesting
              ? "bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse"
              : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500/40"
          }`}
          style={{ height: "42px" }}
        >
          <Mic className="w-4 h-4" strokeWidth={2.5} />
        </button>
        {localError && (
          <div className="absolute bottom-full right-0 mb-2 w-72 z-30 bg-[#1a0f14] border border-rose-500/40 rounded-xl px-3 py-2 shadow-2xl">
            <div className="flex items-start gap-2">
              <span className="text-xs text-rose-200 leading-snug flex-1">🎤 {localError}</span>
              <button type="button" onClick={() => setLocalError(null)} className="text-rose-300/70 hover:text-white text-xs">✕</button>
            </div>
          </div>
        )}
      </div>
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

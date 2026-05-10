"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "denied" | "subscribed" | "available";

export default function PushNotificationsToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported"); return;
      }

      // Busca a public key em runtime (evita problema de NEXT_PUBLIC_* congelado no build).
      let key: string | null = null;
      try {
        const res = await fetch("/api/push/vapid-key");
        if (res.ok) {
          const data = await res.json();
          if (data.configured && data.publicKey) key = data.publicKey;
        }
      } catch { /* fica null */ }

      if (!key) {
        setStatus("unsupported");
        setError("VAPID public key não configurada no servidor.");
        return;
      }
      setPublicKey(key);

      if (Notification.permission === "denied") { setStatus("denied"); return; }

      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        setStatus(sub ? "subscribed" : "available");
      } catch {
        setStatus("unsupported");
      }
    })();
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true); setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "available");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const keyArr = urlBase64ToUint8Array(publicKey);
      // Cast: SharedArrayBuffer-friendly types em DOM lib do TS são chatos —
      // o runtime aceita Uint8Array sem problema.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyArr as unknown as BufferSource,
      });

      const json = sub.toJSON() as any;
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent,
        }),
      });
      setStatus("subscribed");
    } catch (e: any) {
      setError(e?.message ?? "Erro ao ativar notificações");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("available");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao enviar teste");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            🔔 Notificações no navegador
          </h3>
          <p className="text-slate-500 text-xs mt-1">
            Receba alertas no seu computador quando chegar mensagem nova ou sinal quente — mesmo com o LeadHub fechado.
          </p>
        </div>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border flex-shrink-0 ${
          status === "subscribed" ? "bg-green-500/20 text-green-400 border-green-500/40"
          : status === "denied" ? "bg-red-500/20 text-red-400 border-red-500/40"
          : status === "available" ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
          : "bg-slate-500/20 text-slate-400 border-slate-500/40"
        }`}>
          {status === "subscribed" ? "Ativo" :
           status === "denied" ? "Bloqueado" :
           status === "available" ? "Desativado" :
           status === "unsupported" ? "Indisponível" :
           "Carregando"}
        </span>
      </div>

      {status === "unsupported" && (
        <p className="text-slate-600 text-xs italic">
          Seu navegador não suporta notificações Web Push, ou o servidor ainda não foi configurado com chaves VAPID.
        </p>
      )}

      {status === "denied" && (
        <p className="text-slate-600 text-xs italic">
          Permissão bloqueada. Para reativar, vá nas configurações de site do navegador e permita notificações.
        </p>
      )}

      {status === "available" && (
        <button
          onClick={enable}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {busy ? "Ativando..." : "🔔 Ativar notificações"}
        </button>
      )}

      {status === "subscribed" && (
        <div className="flex gap-2">
          <button
            onClick={sendTest}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {busy ? "..." : "Enviar teste"}
          </button>
          <button
            onClick={disable}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Desativar neste navegador
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-xs mt-2 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}

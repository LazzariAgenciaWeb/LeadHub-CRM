"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Shield, CheckCircle2, AlertTriangle, X } from "lucide-react";

const RESEND_COOLDOWN_SEC = 60;

interface Props {
  credentialId?: string;
  onClose: () => void;
  onVerified: () => void;
}

export default function VaultVerifyModal({ credentialId, onClose, onVerified }: Props) {
  const [step, setStep] = useState<"send" | "verify">("send");
  const [sending, setSending]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [sentTo, setSentTo]     = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode]         = useState("");
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cooldown do botão "reenviar"
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Foca o input quando entra no step verify
  useEffect(() => {
    if (step === "verify") inputRef.current?.focus();
  }, [step]);

  async function handleSend() {
    setError(null);
    setSending(true);
    try {
      const r = await fetch("/api/vault/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: credentialId ?? null }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Falha ao enviar código");
        return;
      }
      setChallengeId(data.challengeId);
      setSentTo(data.sentTo);
      setStep("verify");
      setCooldown(RESEND_COOLDOWN_SEC);
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault();
    if (verifying) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Digite os 6 dígitos");
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const r = await fetch("/api/vault/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Código inválido");
        // Limpa pra digitar de novo
        setCode("");
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      // Sucesso
      onVerified();
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setStep("send");
    setCode("");
    setError(null);
    await handleSend();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#1e2d45]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <Shield className="w-4 h-4 text-amber-400" strokeWidth={2.25} />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">Verificação por e-mail</h3>
              <p className="text-slate-500 text-[11px]">Cofre · proteção 2FA</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — Step 1: send */}
        {step === "send" && (
          <div className="px-5 py-5">
            <div className="flex items-start gap-3 mb-4">
              <Mail className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
              <p className="text-slate-300 text-sm leading-relaxed">
                Pra revelar essa senha, vamos mandar um código de 6 dígitos pro
                seu e-mail cadastrado. Vale por 5 minutos.
              </p>
            </div>
            <p className="text-slate-500 text-[11px] mb-4">
              Após validar, novas senhas podem ser reveladas por 15 minutos sem
              precisar de código.
            </p>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs mb-3">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg text-slate-400 bg-[#0a0e16] border border-[#1e2d45] text-sm font-medium hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {sending ? "Enviando..." : "Enviar código"}
              </button>
            </div>
          </div>
        )}

        {/* Body — Step 2: verify */}
        {step === "verify" && (
          <form onSubmit={handleVerify} className="px-5 py-5">
            <div className="flex items-start gap-3 mb-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
              <div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Código enviado para <span className="text-white font-medium">{sentTo}</span>
                </p>
                <p className="text-slate-500 text-[11px] mt-1">
                  Cole ou digite o código de 6 dígitos.
                </p>
              </div>
            </div>

            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full text-center font-mono text-2xl tracking-[0.6em] bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-3 text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 mb-3"
            />

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs mb-3">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || sending}
                className="text-[12px] text-indigo-400 hover:text-indigo-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
              >
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg text-slate-400 bg-[#0a0e16] border border-[#1e2d45] text-sm font-medium hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {verifying ? "Verificando..." : "Verificar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

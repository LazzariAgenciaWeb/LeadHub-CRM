"use client";

import { useState } from "react";

export default function UnsubscribeClient({
  token, email, companyName,
}: {
  token: string;
  email: string;
  companyName: string;
}) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason: reason || null }),
      });
      if (res.ok) setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-8 max-w-md w-full">
        {!done ? (
          <>
            <div className="text-3xl mb-3 text-center">📭</div>
            <h1 className="text-white font-bold text-lg text-center mb-2">
              Cancelar inscrição
            </h1>
            <p className="text-slate-400 text-sm text-center mb-6">
              Você não quer mais receber emails de <strong className="text-white">{companyName}</strong>?
              <br />
              <span className="text-slate-500 text-xs mt-1 inline-block">{email}</span>
            </p>

            <div className="mb-4">
              <label className="block text-slate-400 text-xs font-medium mb-1">Motivo (opcional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Conta pra gente — nos ajuda a melhorar"
                className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            <button
              onClick={confirm}
              disabled={busy}
              className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 mb-2"
            >
              {busy ? "Processando..." : "Sim, cancelar inscrição"}
            </button>
            <p className="text-slate-600 text-[10px] text-center mt-3">
              Você não receberá mais nenhum email desta empresa.
            </p>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <h1 className="text-white font-bold text-lg mb-2">Inscrição cancelada</h1>
            <p className="text-slate-400 text-sm">
              Você não receberá mais emails de <strong className="text-white">{companyName}</strong>.
            </p>
            <p className="text-slate-600 text-xs mt-4">Pode fechar esta janela.</p>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

const MAX_SIGNATURE = 120;

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN:       "Admin",
  CLIENT:      "Usuário",
};

export default function MeuPerfilSettings({
  initialUser,
}: {
  initialUser: {
    id: string;
    name: string;
    email: string;
    role: string;
    whatsappSignature: string | null;
    whatsappSignatureDefault: boolean;
  };
}) {
  const [signature, setSignature]   = useState(initialUser.whatsappSignature ?? "");
  const [defaultOn, setDefaultOn]   = useState(initialUser.whatsappSignatureDefault);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const trimmed = signature.trim();
  const tooLong = trimmed.length > MAX_SIGNATURE;
  const sigDirty     = trimmed !== (initialUser.whatsappSignature ?? "").trim();
  const defaultDirty = defaultOn !== initialUser.whatsappSignatureDefault;
  const dirty        = sigDirty || defaultDirty;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (tooLong) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          whatsappSignature:        trimmed,
          whatsappSignatureDefault: defaultOn,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erro ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl">👤</div>
        <div>
          <h1 className="text-white font-bold text-base">Meu Perfil</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Seus dados de login e preferências pessoais.
          </p>
        </div>
      </div>

      {/* Dados básicos (read-only) */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">Dados da conta</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Para alterar nome ou e-mail, fale com o admin da sua empresa.
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-1">Nome</div>
            <div className="text-white text-sm">{initialUser.name}</div>
          </div>
          <div>
            <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-1">E-mail</div>
            <div className="text-white text-sm break-all">{initialUser.email}</div>
          </div>
          <div>
            <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-1">Perfil</div>
            <div className="text-white text-sm">{ROLE_LABEL[initialUser.role] ?? initialUser.role}</div>
          </div>
        </div>
      </section>

      {/* Assinatura WhatsApp */}
      <section className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">✍️ Assinatura nas mensagens</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            Quando ativada no compositor, será anexada ao final de cada mensagem que você enviar pelo WhatsApp.
          </p>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
              Sua assinatura
            </label>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={`Ex.: ${initialUser.name.split(" ")[0] ?? "Seu nome"} — Atendimento`}
              maxLength={MAX_SIGNATURE + 20}
              className={`w-full bg-[#161f30] border rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none ${
                tooLong ? "border-red-500/50 focus:border-red-500" : "border-[#1e2d45] focus:border-indigo-500"
              }`}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-slate-600 text-[10px]">
                Deixe em branco para não usar assinatura.
              </span>
              <span className={`text-[10px] tabular-nums ${tooLong ? "text-red-400" : "text-slate-600"}`}>
                {trimmed.length}/{MAX_SIGNATURE}
              </span>
            </div>
          </div>

          {/* Preview — simula o WhatsApp: nome em itálico via _underscores_ */}
          <div>
            <div className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-1.5">Pré-visualização (como aparece no WhatsApp)</div>
            <div className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-slate-300 whitespace-pre-wrap font-mono">
              Olá! Vou te ajudar com isso.
              {trimmed && (
                <>
                  {"\n\n-- "}
                  <span className="italic">{trimmed}</span>
                </>
              )}
            </div>
            {trimmed && (
              <p className="text-slate-600 text-[10px] mt-1">
                Enviado como: <code className="text-slate-500">-- _{trimmed}_</code>
              </p>
            )}
          </div>

          {/* Default — começar com checkbox marcado no compositor */}
          <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
            !trimmed ? "opacity-50 cursor-not-allowed border-[#1e2d45] bg-[#161f30]" :
            defaultOn ? "border-indigo-500/40 bg-indigo-500/10" : "border-[#1e2d45] bg-[#161f30] hover:border-[#2d4060]"
          }`}>
            <input
              type="checkbox"
              checked={defaultOn}
              onChange={(e) => setDefaultOn(e.target.checked)}
              disabled={!trimmed}
              className="w-4 h-4 mt-0.5 rounded accent-indigo-500"
            />
            <div className="flex-1">
              <div className="text-slate-200 text-xs font-semibold">Marcar assinatura automaticamente nas conversas</div>
              <div className="text-slate-500 text-[10px] mt-0.5">
                Se ligado, o checkbox <em>Assinar como {initialUser.name.split(" ")[0]}</em> já vem marcado em cada nova conversa.
                Você ainda pode desmarcar pontualmente antes de enviar.
              </div>
            </div>
          </label>

          {error && (
            <div className="text-xs px-3 py-2 rounded-lg border text-red-400 bg-red-500/10 border-red-500/20">
              ❌ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !dirty || tooLong}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            {saved ? "✓ Salvo!" : saving ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </section>
    </div>
  );
}

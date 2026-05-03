"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";

type Member = { id: string; name: string };

/**
 * Botão + modal pra admin registrar incidente vinculado ao projeto.
 * Penaliza um membro com pontos negativos e descrição do que aconteceu.
 * Fica registrado permanentemente no histórico (não é revertido em reset).
 */
export default function IncidentReporter({
  projectId, members,
}: {
  projectId: string;
  members:   Member[];
}) {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [userId, setUserId]           = useState(members[0]?.id ?? "");
  const [points, setPoints]           = useState(20);
  const [description, setDescription] = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!userId || description.trim().length < 10 || points <= 0) {
      setError("Preencha usuário, descrição (≥10 caracteres) e pontos (>0).");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/incidente", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId, points, description: description.trim(), projectId }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Erro ao registrar incidente");
      return;
    }
    setOpen(false);
    setDescription("");
    setPoints(20);
    router.refresh();
  }

  return (
    <>
      <div className="bg-[#0a0f1a] border border-red-900/40 rounded-xl p-5">
        <span className="text-red-400/80 text-xs uppercase tracking-wider block mb-2">
          ⚠️ Incidente
        </span>
        <p className="text-slate-500 text-xs mb-3 leading-relaxed">
          Algo deu errado neste projeto? Documente e penalize o responsável.
          O registro permanece no histórico permanente.
        </p>
        <button
          onClick={() => setOpen(true)}
          disabled={members.length === 0}
          className="w-full px-3 py-2 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 text-red-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Registrar incidente
        </button>
        {members.length === 0 && (
          <p className="text-slate-600 text-[11px] mt-2 text-center">
            Adicione membros à equipe primeiro.
          </p>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="bg-[#0a0f1a] border border-red-900/50 rounded-2xl w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Registrar incidente
                </h3>
                <p className="text-slate-500 text-xs mt-0.5">
                  Penalidade documentada — fica no histórico permanente.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="text-slate-500 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-slate-400 text-xs block mb-1.5">Responsável</label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#080b12] border border-[#1e2d45] text-white text-sm focus:outline-none focus:border-red-500"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-400 text-xs block mb-1.5">
                  Pontos a debitar
                </label>
                <div className="flex gap-2">
                  {[10, 20, 50, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPoints(p)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        points === p
                          ? "bg-red-900/40 border-red-700 text-red-200"
                          : "bg-[#080b12] border-[#1e2d45] text-slate-400 hover:text-white"
                      }`}
                    >
                      −{p}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={points}
                  onChange={(e) => setPoints(Math.max(1, Number(e.target.value) || 0))}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-[#080b12] border border-[#1e2d45] text-white text-sm focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="text-slate-400 text-xs block mb-1.5">
                  O que aconteceu? <span className="text-slate-600">(mín. 10 caracteres)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Ex: cliente ficou sem email por 3 dias por configuração incorreta no setup inicial."
                  className="w-full px-3 py-2 rounded-lg bg-[#080b12] border border-[#1e2d45] text-white text-sm focus:outline-none focus:border-red-500 resize-none"
                />
                <p className="text-slate-600 text-[11px] mt-1">
                  {description.trim().length} caracteres
                </p>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-900/50 text-red-300 text-xs">
                  {error}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#1e2d45] flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving ? "Registrando..." : `Registrar −${points} pts`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

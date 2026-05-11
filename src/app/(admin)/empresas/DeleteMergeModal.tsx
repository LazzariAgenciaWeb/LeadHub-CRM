"use client";

import { useState } from "react";

interface CompanyMin {
  id: string;
  name: string;
  _count?: {
    leads?: number;
    campaigns?: number;
    whatsappInstances?: number;
    subCompanies?: number;
  };
}

interface Props {
  target: CompanyMin;
  // Empresas que podem ser destino do merge (já filtradas pra excluir o próprio target).
  eligibleTargets: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  // Chamado após delete OU após o usuário fechar o relatório de merge.
  // Ex: router.refresh() na lista, router.push("/empresas") na detalhe.
  onDeleted?: () => void;
  onMerged?: () => void;
}

export default function DeleteMergeModal({
  target,
  eligibleTargets,
  open,
  onClose,
  onDeleted,
  onMerged,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"delete" | "merge">("delete");
  const [mergeIntoId, setMergeIntoId] = useState<string>("");
  const [summary, setSummary] = useState<{
    transferred: Record<string, number>;
    conflicts: Record<string, number>;
    targetName: string;
  } | null>(null);

  if (!open) return null;

  function close() {
    if (deleting) return;
    setError(null);
    setMode("delete");
    setMergeIntoId("");
    setSummary(null);
    onClose();
  }

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      if (mode === "merge") {
        if (!mergeIntoId) throw new Error("Selecione a empresa de destino para a mesclagem.");
        const res = await fetch(`/api/companies/${target.id}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: mergeIntoId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Falha ao mesclar");
        const targetName = eligibleTargets.find((c) => c.id === mergeIntoId)?.name ?? "destino";
        setSummary({
          transferred: data.transferred ?? {},
          conflicts: data.conflicts ?? {},
          targetName,
        });
        onMerged?.();
      } else {
        const res = await fetch(`/api/companies/${target.id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Falha ao deletar");
        }
        onDeleted?.();
        close();
      }
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado");
    } finally {
      setDeleting(false);
    }
  }

  const subCount = target._count?.subCompanies ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={close} />
      <div className="relative bg-[#0c1220] border border-red-500/40 rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
          <div>
            <h2 className="text-red-400 font-bold text-base">
              {summary ? "✓ Mesclagem concluída" : mode === "merge" ? "🔀 Mesclar empresa" : "🗑️ Deletar empresa"}
            </h2>
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              <strong className="text-slate-300">{target.name}</strong>
            </p>
          </div>
          <button onClick={close} className="text-slate-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {summary ? (
            <>
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs rounded-lg px-3 py-3 space-y-2">
                <p className="font-semibold">
                  Dados mesclados em <strong className="text-white">{summary.targetName}</strong>. A empresa{" "}
                  <strong className="text-white">{target.name}</strong> foi removida.
                </p>
                <div>
                  <p className="text-emerald-300 font-semibold mb-1">Transferidos:</p>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-emerald-200/80">
                    {Object.entries(summary.transferred)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <li key={k}>{k}: {n}</li>
                      ))}
                  </ul>
                </div>
                {Object.values(summary.conflicts).some((n) => n > 0) && (
                  <div>
                    <p className="text-amber-300 font-semibold mb-1">Conflitos (destino prevaleceu):</p>
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-amber-200/80">
                      {Object.entries(summary.conflicts)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => (
                          <li key={k}>{k}: {n}</li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                onClick={close}
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
              >
                Fechar
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("delete")}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    mode === "delete"
                      ? "bg-red-500/20 border-red-500/50 text-red-300"
                      : "bg-[#161f30] border-[#1e2d45] text-slate-400 hover:text-white"
                  }`}
                >
                  🗑️ Apenas deletar
                </button>
                <button
                  onClick={() => setMode("merge")}
                  disabled={eligibleTargets.length === 0}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${
                    mode === "merge"
                      ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                      : "bg-[#161f30] border-[#1e2d45] text-slate-400 hover:text-white"
                  }`}
                  title={eligibleTargets.length === 0 ? "Nenhuma empresa elegível como destino" : undefined}
                >
                  🔀 Mesclar em outra
                </button>
              </div>

              {mode === "delete" ? (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-3 space-y-1">
                  <p className="font-semibold">⚠️ Esta ação NÃO pode ser desfeita.</p>
                  <p>Vai apagar todos os dados vinculados a esta empresa:</p>
                  {target._count && (
                    <ul className="list-disc list-inside space-y-0.5 text-red-300/80">
                      <li>{target._count.leads ?? 0} leads</li>
                      <li>{target._count.campaigns ?? 0} campanhas</li>
                      <li>{target._count.whatsappInstances ?? 0} instâncias WhatsApp</li>
                      <li>Mensagens, conversas, contatos, setores, tickets, etc.</li>
                    </ul>
                  )}
                  {subCount > 0 && (
                    <p className="mt-2 font-semibold text-amber-300">
                      🚫 Esta empresa tem {subCount} sub-empresa(s). Transfira-as para outra empresa-mãe antes de deletar.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">
                      Empresa de destino (vai receber todos os dados)
                    </label>
                    <select
                      value={mergeIntoId}
                      onChange={(e) => setMergeIntoId(e.target.value)}
                      className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">— Selecione a empresa destino —</option>
                      {eligibleTargets.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs rounded-lg px-3 py-3 space-y-1">
                    <p className="font-semibold">🔀 Mesclagem completa:</p>
                    <p className="text-indigo-200/80">
                      Leads, mensagens, conversas, contatos, tickets, campanhas, tags, custom fields, instâncias WhatsApp,
                      setores, gamificação e configurações vão pra empresa destino. Em conflitos (mesmo telefone, slug ou nome de tag),
                      o destino prevalece — o equivalente da origem é descartado ou renomeado.
                    </p>
                    <p className="text-indigo-200/80 mt-1">
                      Depois da transferência, <strong className="text-white">{target.name}</strong> é deletada.
                    </p>
                  </div>
                  {subCount > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-lg px-3 py-2">
                      ⚠️ As {subCount} sub-empresa(s) vão ser re-vinculadas à empresa destino.
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleConfirm}
                  disabled={
                    deleting ||
                    (mode === "delete" && subCount > 0) ||
                    (mode === "merge" && !mergeIntoId)
                  }
                  className={`flex-1 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 transition-colors ${
                    mode === "merge" ? "bg-indigo-600 hover:bg-indigo-500" : "bg-red-600 hover:bg-red-500"
                  }`}
                >
                  {deleting
                    ? mode === "merge" ? "Mesclando..." : "Deletando..."
                    : mode === "merge" ? "Mesclar e deletar origem" : "Sim, deletar permanentemente"}
                </button>
                <button
                  onClick={close}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-sm transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Modelo de download — colunas esperadas
const TEMPLATE_COLS = ["empresa", "telefone", "especialidades", "site", "rating", "review", "mensagens", "disparo"];

function generateCsvTemplate() {
  const header = TEMPLATE_COLS.join(";");
  const example = ["Clínica Exemplo", "5511999999999", "Odontologia", "https://exemplo.com.br", "4.5", "Ótimo atendimento", "Olá, vi que vocês são referência em...", "2024-01-15"].join(";");
  return `${header}\n${example}`;
}

export default function ImportExcel({ pipeline }: { pipeline: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ imported: number; skipped: number; total: number; errors?: string[] } | null>(null);
  const [error, setError]     = useState("");

  if (pipeline !== "PROSPECCAO") return null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      let records: Record<string, string>[] = [];

      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        // Parse CSV
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/["\s]/g, ""));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map(v => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
          records.push(row);
        }
      } else {
        // Parse XLSX
        const XLSX = await import("xlsx");
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
        records = raw.map((row) => {
          const out: Record<string, string> = {};
          for (const k of Object.keys(row)) {
            out[k.toLowerCase().trim()] = String(row[k] ?? "").trim();
          }
          return out;
        });
      }

      if (records.length === 0) { setError("Arquivo vazio ou formato inválido."); setLoading(false); return; }

      const res  = await fetch("/api/sync/bdr/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erro ao importar"); setLoading(false); return; }
      setResult(data);
      if (data.imported > 0) router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado");
    }
    setLoading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const csv  = generateCsvTemplate();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "modelo_prospects.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setResult(null); setError(""); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex-shrink-0"
      >
        📥 Importar Excel
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-md mx-4 shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-base">📥 Importar Prospectos</h2>
                <p className="text-slate-500 text-xs mt-0.5">Excel (.xlsx) ou CSV (.csv)</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Instruções */}
              <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4 text-xs text-slate-400 space-y-1">
                <p className="text-slate-300 font-semibold mb-2">Colunas esperadas:</p>
                {TEMPLATE_COLS.map((c) => (
                  <div key={c} className="flex gap-2">
                    <span className="text-indigo-400 font-mono w-24 flex-shrink-0">{c}</span>
                    <span className="text-slate-500">
                      {c === "telefone" ? "obrigatório — ex: 5511999999999" :
                       c === "empresa"  ? "nome do negócio" :
                       c === "site"     ? "URL — detecta Instagram/Facebook automaticamente" :
                       c === "mensagens" ? "mensagem enviada pelo BDR" : "opcional"}
                    </span>
                  </div>
                ))}
              </div>

              <button
                onClick={downloadTemplate}
                className="w-full py-2 rounded-lg border border-dashed border-[#1e2d45] text-slate-400 hover:text-white hover:border-indigo-500/30 text-sm transition-colors"
              >
                ⬇️ Baixar modelo CSV
              </button>

              {/* Upload */}
              <label className={`w-full flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${loading ? "border-[#1e2d45] opacity-50" : "border-[#1e2d45] hover:border-indigo-500/50"}`}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  className="hidden"
                  onChange={handleFile}
                  disabled={loading}
                />
                <div className="text-3xl mb-2">{loading ? "⏳" : "📂"}</div>
                <p className="text-slate-400 text-sm font-medium">
                  {loading ? "Processando..." : "Clique para selecionar o arquivo"}
                </p>
                <p className="text-slate-600 text-xs mt-1">.xlsx, .xls, .csv</p>
              </label>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {result && (
                <div className={`rounded-lg px-4 py-3 text-sm border ${result.imported > 0 ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"}`}>
                  <p className="font-semibold">
                    {result.imported > 0 ? `✅ ${result.imported} prospects importados!` : "ℹ️ Nenhum novo importado"}
                  </p>
                  <p className="text-xs mt-1 opacity-70">
                    {result.skipped} ignorados (já existiam) · {result.total} no arquivo
                  </p>
                  {result.errors && result.errors.length > 0 && (
                    <p className="text-xs mt-1 text-red-400">{result.errors.length} erros</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

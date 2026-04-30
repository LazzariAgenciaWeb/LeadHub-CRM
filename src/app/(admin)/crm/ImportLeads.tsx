"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const PIPELINES = [
  { value: "PROSPECCAO", label: "🔎 Prospecção" },
  { value: "LEADS",      label: "🎯 Leads" },
  { value: "OPORTUNIDADES", label: "💡 Oportunidades" },
];

// Colunas aceitas — qualquer variação de nome
const FIELD_MAP: Record<string, string[]> = {
  phone: ["phone", "telefone", "cel", "celular", "whatsapp", "fone"],
  name:  ["name", "nome", "empresa", "company", "cliente"],
  email: ["email", "e-mail", "correio"],
  source: ["source", "origem", "canal", "utm_source"],
  notes: ["notes", "observacoes", "observações", "anotacoes", "mensagem", "descricao"],
};

function resolveField(row: Record<string, string>, field: string): string {
  const variants = FIELD_MAP[field] ?? [field];
  for (const v of variants) {
    const val = row[v] ?? row[v.toLowerCase()] ?? "";
    if (val.trim()) return val.trim();
  }
  return "";
}

function generateTemplate() {
  const header = "name;phone;email;source;pipeline;notes";
  const rows = [
    "João Silva;5511999990001;joao@email.com;formulario-site;PROSPECCAO;Interesse no plano Pro",
    "Maria Souza;5521988880002;;instagram;LEADS;",
    "Empresa ABC;5531977770003;contato@abc.com.br;indicacao;OPORTUNIDADES;Orçamento solicitado",
  ];
  return [header, ...rows].join("\n");
}

export default function ImportLeads({ pipeline }: { pipeline?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [targetPipeline, setTargetPipeline] = useState(pipeline ?? "PROSPECCAO");
  const [result, setResult]     = useState<{ imported: number; skipped: number; total: number; errors?: string[] } | null>(null);
  const [error, setError]       = useState("");

  function downloadTemplate() {
    const blob = new Blob(["﻿" + generateTemplate()], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "modelo_importacao_leads.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      let records: Record<string, string>[] = [];

      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
        const sep = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/["\s]/g, ""));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
          records.push(row);
        }
      } else {
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

      if (records.length === 0) {
        setError("Arquivo vazio ou formato inválido.");
        setLoading(false);
        return;
      }

      // Normaliza para campos padrão antes de enviar
      const normalized = records.map((row) => ({
        phone:    resolveField(row, "phone"),
        name:     resolveField(row, "name")  || null,
        email:    resolveField(row, "email") || null,
        source:   resolveField(row, "source") || "importacao",
        pipeline: (resolveField(row, "pipeline") || targetPipeline).toUpperCase(),
        notes:    resolveField(row, "notes") || null,
      }));

      const res  = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: normalized, pipeline: targetPipeline }),
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

  return (
    <>
      <button
        onClick={() => { setOpen(true); setResult(null); setError(""); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex-shrink-0"
      >
        📥 Importar Leads
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#0c1220] border border-[#1e2d45] rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1e2d45] flex items-center justify-between">
              <div>
                <h2 className="text-white font-bold text-base">📥 Importar Leads</h2>
                <p className="text-slate-500 text-xs mt-0.5">Excel (.xlsx) ou CSV (.csv)</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Pipeline destino */}
              <div>
                <label className="block text-slate-400 text-xs font-semibold mb-1.5">Importar para o pipeline</label>
                <select
                  value={targetPipeline}
                  onChange={(e) => setTargetPipeline(e.target.value)}
                  className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {PIPELINES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <p className="text-slate-600 text-[11px] mt-1">
                  Leads com coluna "pipeline" preenchida ignoram esta seleção.
                </p>
              </div>

              {/* Colunas aceitas */}
              <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4 text-xs text-slate-400 space-y-1">
                <p className="text-slate-300 font-semibold mb-2">Colunas reconhecidas:</p>
                {[
                  { col: "phone / telefone",  req: true,  desc: "obrigatório — ex: 5511999990001" },
                  { col: "name / nome",       req: false, desc: "nome ou empresa" },
                  { col: "email",             req: false, desc: "e-mail de contato" },
                  { col: "source / origem",   req: false, desc: "origem do lead (ex: instagram)" },
                  { col: "pipeline",          req: false, desc: "PROSPECCAO, LEADS ou OPORTUNIDADES" },
                  { col: "notes / observacoes", req: false, desc: "anotações internas" },
                ].map(({ col, req, desc }) => (
                  <div key={col} className="flex gap-2">
                    <span className="text-indigo-400 font-mono w-36 flex-shrink-0">{col}</span>
                    <span className={req ? "text-red-400" : "text-slate-500"}>{req ? "★ " : ""}{desc}</span>
                  </div>
                ))}
              </div>

              {/* Baixar modelo */}
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
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>
              )}

              {result && (
                <div className={`rounded-lg px-4 py-3 text-sm border ${result.imported > 0 ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"}`}>
                  <p className="font-semibold">
                    {result.imported > 0 ? `✅ ${result.imported} leads importados!` : "ℹ️ Nenhum novo importado"}
                  </p>
                  <p className="text-xs mt-1 opacity-70">
                    {result.skipped} ignorados (já existiam) · {result.total} no arquivo
                  </p>
                  {result.errors && result.errors.length > 0 && (
                    <p className="text-xs mt-1 text-red-400">{result.errors.length} erro(s)</p>
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

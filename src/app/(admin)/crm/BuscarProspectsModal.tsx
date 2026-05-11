"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SerpResult = {
  placeId: string | null;
  name: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  rating: number | null;
  reviews: number | null;
  type: string | null;
  alreadyImported?: boolean;
};

type ImportResult = {
  imported: number;
  duplicates: number;
  withSite: number;
  withEmail: number;
  withWhatsapp: number;
  total: number;
  errors?: string[];
};

export default function BuscarProspectsModal({
  isSuperAdmin,
  defaultCompanyId,
}: {
  isSuperAdmin: boolean;
  defaultCompanyId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<SerpResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportResult | null>(null);

  function close() {
    setOpen(false);
    // Não limpa estado pra reabrir e ver o resumo / continuar.
  }

  function reset() {
    setQuery("");
    setCity("");
    setResults([]);
    setSelected(new Set());
    setError("");
    setSummary(null);
  }

  async function handleSearch() {
    setError("");
    setSummary(null);
    setResults([]);
    setSelected(new Set());
    if (!query.trim()) {
      setError("Informe o nicho ou termo de busca");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/prospeccao/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          city: city.trim(),
          limit,
          companyId: isSuperAdmin ? defaultCompanyId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Falha na busca");
        return;
      }
      setResults(data.results ?? []);
      // pré-seleciona apenas os que NÃO estão já importados
      setSelected(
        new Set(
          (data.results ?? [])
            .filter((r: SerpResult) => !r.alreadyImported)
            .map((r: SerpResult) => r.placeId ?? r.name ?? "")
            .filter(Boolean)
        )
      );
    } catch (err: any) {
      setError(err?.message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    const selectable = results.filter((r) => !r.alreadyImported);
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((r) => r.placeId ?? r.name ?? "").filter(Boolean)));
    }
  }

  async function handleImport() {
    setError("");
    const toImport = results.filter((r) => selected.has(r.placeId ?? r.name ?? ""));
    if (toImport.length === 0) {
      setError("Selecione ao menos um prospect");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/prospeccao/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospects: toImport,
          companyId: isSuperAdmin ? defaultCompanyId : undefined,
          defaultCity: city.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Falha na importação");
        return;
      }
      setSummary(data);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Erro inesperado");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors flex-shrink-0"
        title="Buscar prospects no Google Maps via SerpAPI"
      >
        🔍 Buscar prospects
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-[#0b1220] border border-[#1e2d45] rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45] flex-shrink-0">
              <div>
                <h2 className="text-white font-semibold text-lg">🔍 Buscar prospects</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  Google Maps via SerpAPI · scraper inline pra email/Instagram/Facebook
                </p>
              </div>
              <button
                onClick={close}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <div className="px-6 py-4 border-b border-[#1e2d45] flex-shrink-0">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-slate-400 block mb-1">Nicho / termo *</label>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ex: clínica pediátrica"
                    className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                    }}
                  />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs text-slate-400 block mb-1">Cidade</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="ex: Curitiba PR"
                    className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSearch();
                    }}
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-slate-400 block mb-1">Qtd</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value) || 20)}
                    className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {loading ? "⏳ Buscando..." : "Buscar"}
                </button>
              </div>
              {error && (
                <div className="mt-3 text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
                  ⚠️ {error}
                </div>
              )}
              {summary && (
                <div className="mt-3 text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2">
                  ✅ <strong>{summary.imported}</strong> importados ·{" "}
                  <strong>{summary.withSite}</strong> com site ·{" "}
                  <strong>{summary.withEmail}</strong> com email ·{" "}
                  <strong>{summary.withWhatsapp}</strong> com WhatsApp ·{" "}
                  <strong>{summary.duplicates}</strong> duplicados
                  {summary.errors && summary.errors.length > 0 && (
                    <div className="mt-1 text-xs text-amber-300">
                      Erros: {summary.errors.join("; ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {results.length === 0 && !loading && (
                <div className="text-center text-slate-500 text-sm py-12">
                  Faça uma busca pra ver resultados aqui.
                </div>
              )}
              {results.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-3 sticky top-0 bg-[#0b1220] py-2">
                    <button
                      onClick={toggleAll}
                      className="text-xs text-slate-300 hover:text-white"
                    >
                      {(() => {
                        const selectable = results.filter((r) => !r.alreadyImported).length;
                        return selected.size === selectable && selectable > 0
                          ? "✖ Desmarcar todos"
                          : "✔ Selecionar todos";
                      })()}
                    </button>
                    <span className="text-xs text-slate-500">
                      {selected.size} selecionados · {results.filter((r) => r.alreadyImported).length} já listados
                    </span>
                  </div>
                  <div className="space-y-2">
                    {results.map((r, idx) => {
                      const key = r.placeId ?? r.name ?? `idx-${idx}`;
                      const isOn = selected.has(key);
                      const dup = !!r.alreadyImported;
                      return (
                        <label
                          key={key}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            dup
                              ? "bg-slate-900/40 border-slate-800 opacity-60 cursor-not-allowed"
                              : isOn
                              ? "bg-sky-950/30 border-sky-700 cursor-pointer"
                              : "bg-[#0f1623] border-[#1e2d45] hover:border-slate-600 cursor-pointer"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isOn}
                            disabled={dup}
                            onChange={() => !dup && toggle(key)}
                            className="mt-1 accent-sky-500 disabled:cursor-not-allowed"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-white font-medium">{r.name ?? "(sem nome)"}</span>
                              {dup && (
                                <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-300 bg-amber-900/40 border border-amber-700/50 px-1.5 py-0.5 rounded">
                                  Já listado
                                </span>
                              )}
                              {r.rating != null && (
                                <span className="text-xs text-amber-400">★ {r.rating} ({r.reviews ?? 0})</span>
                              )}
                              {r.type && (
                                <span className="text-xs text-indigo-300 bg-indigo-950/50 px-1.5 py-0.5 rounded">
                                  {r.type}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                              {r.address && <div>📍 {r.address}</div>}
                              <div className="flex gap-3 flex-wrap">
                                {r.phone && <span>📞 {r.phone}</span>}
                                {r.website && (
                                  <a
                                    href={r.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sky-400 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    🌐 {new URL(r.website).hostname}
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#1e2d45] flex items-center justify-between flex-shrink-0">
              <div className="text-xs text-slate-500">
                Email/Instagram/Facebook são extraídos do site na hora da importação (timeout 6s/site).
              </div>
              <div className="flex gap-2">
                <button
                  onClick={close}
                  className="px-4 py-2 rounded-lg bg-[#1e2d45] hover:bg-[#2a3a55] text-white text-sm transition-colors"
                >
                  Fechar
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || selected.size === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? "⏳ Importando..." : `📥 Importar ${selected.size}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

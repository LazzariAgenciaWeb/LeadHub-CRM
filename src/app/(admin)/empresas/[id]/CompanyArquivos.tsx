"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadFile } from "@/components/attachments/upload";
import { linkKind, isImageMime, fileEmoji } from "@/lib/link-kind";

// Biblioteca de arquivos do cliente — o que aparece em Meu Espaço → Arquivos.
// Links (Drive, YouTube, materiais) e arquivos (MinIO), em pastas.

type Item = {
  id: string;
  folder: string;
  kind: "LINK" | "FILE";
  title: string;
  description: string | null;
  url: string | null;
  visibleToClient: boolean;
  createdByName: string | null;
  createdAt: string;
  storageObject: { id: string; fileName: string; mimeType: string; size: number } | null;
};

type Uploading = { key: string; name: string; pct: number; error?: string };

const inCls =
  "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

const fmtData = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function CompanyArquivos({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [folder, setFolder] = useState<string>("__all");
  const [q, setQ] = useState("");

  const [linkOpen, setLinkOpen] = useState(false);
  const [lf, setLf] = useState({ title: "", url: "", folder: "", description: "", visible: true });
  const [savingLink, setSavingLink] = useState(false);

  const [uploadFolder, setUploadFolder] = useState("");
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ title: "", folder: "", description: "", url: "" });

  async function load() {
    const res = await fetch(`/api/biblioteca/${clientId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Não foi possível carregar"); setItems([]); return; }
    setItems(data.items ?? []);
    setDefaults(data.defaultFolders ?? []);
    setEnabled(data.storageEnabled !== false);
  }
  useEffect(() => { void load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(() => {
    const used = new Map<string, number>();
    for (const it of items ?? []) used.set(it.folder, (used.get(it.folder) ?? 0) + 1);
    return [...used.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [items]);
  const folderOptions = useMemo(
    () => [...new Set([...folders.map(([f]) => f), ...defaults])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [folders, defaults],
  );
  const currentFolder = folder === "__all" ? "" : folder;

  const visibleItems = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items ?? []).filter((it) => {
      if (folder !== "__all" && it.folder !== folder) return false;
      if (!term) return true;
      return [it.title, it.description, it.folder, it.url, it.storageObject?.fileName]
        .some((v) => v?.toLowerCase().includes(term));
    });
  }, [items, folder, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of visibleItems) (m.get(it.folder) ?? m.set(it.folder, []).get(it.folder)!).push(it);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [visibleItems]);

  async function addLink() {
    if (!lf.url.trim()) return;
    setSavingLink(true);
    const res = await fetch(`/api/biblioteca/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "LINK", title: lf.title, url: lf.url, description: lf.description,
        folder: lf.folder || currentFolder, visibleToClient: lf.visible,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingLink(false);
    if (!res.ok) { alert(data.error ?? "Não foi possível salvar o link"); return; }
    setItems((prev) => [data.item, ...(prev ?? [])]);
    setLf({ title: "", url: "", folder: "", description: "", visible: true });
    setLinkOpen(false);
  }

  async function handleFiles(list: FileList | File[] | null) {
    if (!list) return;
    const target = uploadFolder || currentFolder || "Geral";
    for (const file of Array.from(list)) {
      const key = `${Date.now()}-${Math.random()}`;
      setUploading((u) => [...u, { key, name: file.name, pct: 0 }]);
      try {
        const saved = await uploadFile(file, { libraryCompanyId: clientId }, {
          onProgress: (pct) => setUploading((u) => u.map((x) => (x.key === key ? { ...x, pct } : x))),
        });
        const res = await fetch(`/api/biblioteca/${clientId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "FILE", storageObjectId: saved.id, folder: target }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Falha ao registrar o arquivo");
        setItems((prev) => [data.item, ...(prev ?? [])]);
        setUploading((u) => u.filter((x) => x.key !== key));
      } catch (e: any) {
        setUploading((u) => u.map((x) => (x.key === key ? { ...x, error: e?.message ?? "Erro" } : x)));
      }
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/biblioteca/${clientId}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error ?? "Não foi possível salvar"); return false; }
    setItems((prev) => (prev ?? []).map((x) => (x.id === id ? data.item : x)));
    return true;
  }

  async function remove(it: Item) {
    if (!confirm(`Excluir "${it.title}" da biblioteca?${it.kind === "FILE" ? " O arquivo será apagado." : ""}`)) return;
    const res = await fetch(`/api/biblioteca/${clientId}/${it.id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => (prev ?? []).filter((x) => x.id !== it.id));
    else alert((await res.json().catch(() => ({}))).error ?? "Não foi possível excluir");
  }

  function startEdit(it: Item) {
    setEditId(it.id);
    setEf({ title: it.title, folder: it.folder, description: it.description ?? "", url: it.url ?? "" });
  }
  async function saveEdit(it: Item) {
    const ok = await patch(it.id, {
      title: ef.title, folder: ef.folder, description: ef.description,
      ...(it.kind === "LINK" ? { url: ef.url } : {}),
    });
    if (ok) setEditId(null);
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (items === null) return <p className="text-sm text-slate-500">Carregando…</p>;

  return (
    <div className="space-y-4">
      <datalist id={`lib-folders-${clientId}`}>
        {folderOptions.map((f) => <option key={f} value={f} />)}
      </datalist>

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-semibold text-sm">🗂 Arquivos do cliente</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            O que você colocar aqui aparece pro cliente em <b className="text-slate-400">Meu Espaço → Arquivos</b>, separado por pastas e com busca.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLinkOpen((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-200 text-xs font-medium hover:border-indigo-500/50"
          >
            🔗 Adicionar link
          </button>
          {enabled && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
            >
              ⬆ Enviar arquivos
            </button>
          )}
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {/* Form de link */}
      {linkOpen && (
        <div className="bg-[#0f1623] border border-indigo-500/30 rounded-xl p-4 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input autoFocus value={lf.url} onChange={(e) => setLf({ ...lf, url: e.target.value })} placeholder="https:// (Drive, YouTube, Canva…)" className={inCls} />
            <input value={lf.title} onChange={(e) => setLf({ ...lf, title: e.target.value })} placeholder="Título (ex.: Pasta de logos no Drive)" className={inCls} />
            <input list={`lib-folders-${clientId}`} value={lf.folder} onChange={(e) => setLf({ ...lf, folder: e.target.value })} placeholder={`Pasta (${currentFolder || "Geral"})`} className={inCls} />
            <input value={lf.description} onChange={(e) => setLf({ ...lf, description: e.target.value })} placeholder="Descrição (opcional)" className={inCls} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={lf.visible} onChange={(e) => setLf({ ...lf, visible: e.target.checked })} className="w-3.5 h-3.5" />
              Cliente vê
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setLinkOpen(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancelar</button>
              <button type="button" onClick={addLink} disabled={savingLink || !lf.url.trim()} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium">
                {savingLink ? "Salvando…" : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Área de soltar arquivos + pasta de destino */}
      {enabled && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
          className={`rounded-xl border border-dashed px-4 py-3 flex items-center gap-3 flex-wrap text-xs transition-colors ${
            dragOver ? "border-indigo-500 bg-indigo-500/5" : "border-[#2a3d5a]"
          }`}
        >
          <span className="text-slate-500 flex-1 min-w-[180px]">Arraste arquivos aqui (logos, artes, PDFs, vídeos…)</span>
          <label className="flex items-center gap-1.5 text-slate-500">
            Enviar para a pasta
            <input
              list={`lib-folders-${clientId}`}
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              placeholder={currentFolder || "Geral"}
              className="bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1 text-slate-200 w-40 focus:outline-none focus:border-indigo-500"
            />
          </label>
        </div>
      )}
      {uploading.length > 0 && (
        <div className="space-y-1">
          {uploading.map((u) => (
            <div key={u.key} className="flex items-center gap-2 text-[11px] bg-[#0a0f1a] border border-[#1e2d45] rounded px-2 py-1">
              <span className={`truncate flex-1 ${u.error ? "text-red-400" : "text-slate-400"}`}>{u.name}{u.error ? ` — ${u.error}` : ""}</span>
              {u.error
                ? <button type="button" onClick={() => setUploading((l) => l.filter((x) => x.key !== u.key))} className="text-slate-500 hover:text-white">×</button>
                : <span className="text-slate-600">{u.pct}%</span>}
            </div>
          ))}
        </div>
      )}

      {/* Busca + pastas */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Buscar por nome, descrição ou link…" className={`${inCls} max-w-xs !py-1.5 !text-xs`} />
        <button
          type="button"
          onClick={() => setFolder("__all")}
          className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${folder === "__all" ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200" : "border-[#1e2d45] text-slate-500 hover:text-slate-300"}`}
        >
          Todas ({items.length})
        </button>
        {folders.map(([f, n]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFolder(f)}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${folder === f ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200" : "border-[#1e2d45] text-slate-500 hover:text-slate-300"}`}
          >
            📁 {f} ({n})
          </button>
        ))}
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          Nada na biblioteca ainda. Adicione um link do Drive ou envie os arquivos que você fez pro cliente.
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">Nada encontrado.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([f, list]) => (
            <div key={f}>
              {folder === "__all" && <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">📁 {f}</h4>}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {list.map((it) => {
                  const so = it.storageObject;
                  const href = it.kind === "LINK" ? it.url! : `/api/storage/${so?.id}`;
                  const lk = it.kind === "LINK" ? linkKind(it.url) : null;
                  const editing = editId === it.id;
                  return (
                    <div key={it.id} className={`group bg-[#0f1623] border rounded-xl p-3 ${it.visibleToClient ? "border-[#1e2d45]" : "border-dashed border-slate-700 opacity-75"}`}>
                      <div className="flex gap-3">
                        <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          {it.kind === "FILE" && so && isImageMime(so.mimeType) ? (
                            <img src={`/api/storage/${so.id}`} alt={it.title} loading="lazy" className="w-16 h-16 object-cover rounded-lg border border-[#1e2d45]" />
                          ) : (
                            <span className="w-16 h-16 rounded-lg border border-[#1e2d45] bg-[#0a0f1a] flex items-center justify-center text-2xl">
                              {lk ? lk.icon : fileEmoji(so?.mimeType, so?.fileName)}
                            </span>
                          )}
                        </a>
                        <div className="flex-1 min-w-0">
                          {editing ? (
                            <div className="space-y-1.5">
                              <input value={ef.title} onChange={(e) => setEf({ ...ef, title: e.target.value })} className={`${inCls} !py-1 !text-xs`} placeholder="Título" />
                              {it.kind === "LINK" && <input value={ef.url} onChange={(e) => setEf({ ...ef, url: e.target.value })} className={`${inCls} !py-1 !text-xs`} placeholder="https://…" />}
                              <input list={`lib-folders-${clientId}`} value={ef.folder} onChange={(e) => setEf({ ...ef, folder: e.target.value })} className={`${inCls} !py-1 !text-xs`} placeholder="Pasta" />
                              <textarea value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} rows={2} className={`${inCls} !py-1 !text-xs resize-y`} placeholder="Descrição" />
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setEditId(null)} className="text-[11px] text-slate-500 hover:text-white">Cancelar</button>
                                <button type="button" onClick={() => void saveEdit(it)} className="text-[11px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium">Salvar</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <a href={href} target="_blank" rel="noopener noreferrer" className="block text-sm text-slate-100 font-medium truncate hover:text-indigo-300" title={it.title}>
                                {it.title}
                              </a>
                              <p className="text-[11px] text-slate-500 truncate">
                                {lk ? lk.label : so ? `${so.fileName} · ${fmtSize(so.size)}` : ""}
                              </p>
                              {it.description && <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap">{it.description}</p>}
                              <p className="text-[10px] text-slate-600 mt-1">
                                {it.createdByName ? `${it.createdByName} · ` : ""}{fmtData(it.createdAt)}
                                {!it.visibleToClient && <span className="ml-1 text-amber-400/80">· oculto do cliente</span>}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      {!editing && (
                        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#1e2d45] text-[11px]">
                          <button type="button" onClick={() => void patch(it.id, { visibleToClient: !it.visibleToClient })} className={it.visibleToClient ? "text-emerald-400 hover:text-emerald-300" : "text-slate-500 hover:text-slate-300"} title="Alternar visibilidade pro cliente">
                            {it.visibleToClient ? "👁 Cliente vê" : "🙈 Oculto"}
                          </button>
                          {it.kind === "FILE" && so && (
                            <a href={`/api/storage/${so.id}?download=1`} className="text-slate-400 hover:text-white">⬇ Baixar</a>
                          )}
                          <button type="button" onClick={() => startEdit(it)} className="text-slate-400 hover:text-white ml-auto">✎ Editar</button>
                          <button type="button" onClick={() => void remove(it)} className="text-slate-500 hover:text-red-400">Excluir</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

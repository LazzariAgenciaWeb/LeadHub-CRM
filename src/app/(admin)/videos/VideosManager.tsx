"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MonitorPlay, Plus, Pencil, Trash2, Share2, GripVertical, Eye, Users, X } from "lucide-react";

type Video = {
  id: string;
  title: string;
  description: string | null;
  youtubeId: string;
  thumbnailUrl: string | null;
  durationLabel: string | null;
  active: boolean;
  position: number;
};
type Category = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  accent: string | null;
  active: boolean;
  visibility: "ALL" | "SELECTED";
  position: number;
  releaseCompanyIds: string[];
  videos: Video[];
};
type CompanyOpt = { id: string; name: string };

// Parser client-side só pra prévia da capa (o servidor revalida no POST).
function ytId(input: string): string | null {
  const raw = (input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const res = [/[?&]v=([A-Za-z0-9_-]{11})/, /youtu\.be\/([A-Za-z0-9_-]{11})/, /\/embed\/([A-Za-z0-9_-]{11})/, /\/shorts\/([A-Za-z0-9_-]{11})/, /\/live\/([A-Za-z0-9_-]{11})/];
  for (const re of res) { const m = raw.match(re); if (m) return m[1]; }
  return null;
}
const thumb = (v: Video) => v.thumbnailUrl || `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`;

export default function VideosManager({
  scope, categories, companies,
}: {
  scope: "GLOBAL" | "COMPANY";
  categories: Category[];
  companies: CompanyOpt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [catModal, setCatModal] = useState<null | { mode: "create" } | { mode: "edit"; cat: Category }>(null);
  const [videoModal, setVideoModal] = useState<null | { categoryId: string } | { mode: "edit"; video: Video }>(null);
  const [releaseModal, setReleaseModal] = useState<null | Category>(null);

  async function api(url: string, method: string, body?: any) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro na operação");
      }
      router.refresh();
      return true;
    } catch (e: any) {
      alert(e.message || "Erro");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const totalVideos = categories.reduce((s, c) => s + c.videos.length, 0);

  return (
    <div className="max-w-5xl mx-auto px-1 py-2 text-slate-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 flex items-center justify-center">
              <MonitorPlay className="w-5 h-5 text-white" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-bold text-white">Vídeos</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1.5">
            {scope === "GLOBAL"
              ? "Biblioteca central — organize trilhas e libere pra cada empresa."
              : "Trilhas de vídeo pros seus clientes (material de apoio)."}
            {" "}<span className="text-slate-500">{categories.length} trilhas · {totalVideos} vídeos</span>
          </p>
        </div>
        <button onClick={() => setCatModal({ mode: "create" })}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shrink-0">
          <Plus className="w-4 h-4" /> Nova trilha
        </button>
      </div>

      {/* Empty */}
      {categories.length === 0 && (
        <div className="border border-dashed border-[#2a3d56] rounded-2xl p-12 text-center">
          <MonitorPlay className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">Nenhuma trilha ainda</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">Crie uma trilha (ex.: “Primeiros passos”) e adicione vídeos do YouTube.</p>
          <button onClick={() => setCatModal({ mode: "create" })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500">
            <Plus className="w-4 h-4" /> Criar primeira trilha
          </button>
        </div>
      )}

      {/* Categorias */}
      <div className="flex flex-col gap-5">
        {categories.map((cat) => (
          <div key={cat.id} className="rounded-2xl border border-[#1e2d45] bg-[#0f1623] overflow-hidden">
            {/* head */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e2d45]">
              <GripVertical className="w-4 h-4 text-slate-600 shrink-0" />
              <span className="text-lg leading-none">{cat.emoji || "🎬"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-semibold text-[15px] truncate">{cat.title}</h2>
                  {!cat.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">oculta</span>}
                  <VisBadge cat={cat} companies={companies} />
                </div>
                {cat.description && <p className="text-xs text-slate-500 truncate">{cat.description}</p>}
              </div>
              <span className="text-xs text-slate-500 shrink-0">{cat.videos.length} vídeo{cat.videos.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn title="Liberar" onClick={() => setReleaseModal(cat)}><Share2 className="w-4 h-4" /></IconBtn>
                <IconBtn title="Editar trilha" onClick={() => setCatModal({ mode: "edit", cat })}><Pencil className="w-4 h-4" /></IconBtn>
                <IconBtn title="Excluir trilha" danger onClick={async () => {
                  if (confirm(`Excluir a trilha “${cat.title}” e seus ${cat.videos.length} vídeos?`)) await api(`/api/videos/categories/${cat.id}`, "DELETE");
                }}><Trash2 className="w-4 h-4" /></IconBtn>
              </div>
            </div>

            {/* vídeos */}
            <div className="p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {cat.videos.map((v) => (
                  <div key={v.id} className="group relative rounded-xl overflow-hidden border border-[#1e2d45] bg-[#0a1120]">
                    <div className="relative aspect-video bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(v)} alt={v.title} className="w-full h-full object-cover" />
                      {v.durationLabel && <span className="absolute bottom-1 right-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/80 text-white">{v.durationLabel}</span>}
                      {!v.active && <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300">oculto</span>}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <IconBtn title="Editar" onClick={() => setVideoModal({ mode: "edit", video: v })}><Pencil className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Excluir" danger onClick={async () => { if (confirm(`Excluir “${v.title}”?`)) await api(`/api/videos/${v.id}`, "DELETE"); }}><Trash2 className="w-4 h-4" /></IconBtn>
                      </div>
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-slate-200 font-medium line-clamp-2 leading-snug">{v.title}</p>
                    </div>
                  </div>
                ))}
                {/* add card */}
                <button onClick={() => setVideoModal({ categoryId: cat.id })}
                  className="rounded-xl border border-dashed border-[#2a3d56] hover:border-indigo-500 hover:bg-indigo-500/5 transition-colors aspect-video flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-indigo-300">
                  <Plus className="w-5 h-5" />
                  <span className="text-xs font-medium">Adicionar vídeo</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {catModal && (
        <CategoryModal
          scope={scope}
          initial={catModal.mode === "edit" ? catModal.cat : null}
          busy={busy}
          onClose={() => setCatModal(null)}
          onSubmit={async (payload) => {
            const ok = catModal.mode === "edit"
              ? await api(`/api/videos/categories/${catModal.cat.id}`, "PATCH", payload)
              : await api(`/api/videos/categories`, "POST", payload);
            if (ok) setCatModal(null);
          }}
        />
      )}

      {videoModal && (
        <VideoModal
          initial={"mode" in videoModal ? videoModal.video : null}
          busy={busy}
          onClose={() => setVideoModal(null)}
          onSubmit={async (payload) => {
            const ok = "mode" in videoModal
              ? await api(`/api/videos/${videoModal.video.id}`, "PATCH", payload)
              : await api(`/api/videos`, "POST", { ...payload, categoryId: videoModal.categoryId });
            if (ok) setVideoModal(null);
          }}
        />
      )}

      {releaseModal && (
        <ReleaseModal
          cat={releaseModal}
          companies={companies}
          scope={scope}
          busy={busy}
          onClose={() => setReleaseModal(null)}
          onSubmit={async (visibility, releaseCompanyIds) => {
            const ok = await api(`/api/videos/categories/${releaseModal.id}`, "PATCH", { visibility, releaseCompanyIds });
            if (ok) setReleaseModal(null);
          }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${danger ? "text-slate-400 hover:text-red-400 hover:bg-red-500/10" : "text-slate-400 hover:text-white hover:bg-white/10"}`}>
      {children}
    </button>
  );
}

function VisBadge({ cat, companies }: { cat: Category; companies: CompanyOpt[] }) {
  if (cat.visibility === "ALL")
    return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300"><Eye className="w-3 h-3" /> todos</span>;
  const n = cat.releaseCompanyIds.filter((id) => companies.some((c) => c.id === id)).length;
  return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300"><Users className="w-3 h-3" /> {n} empresa{n === 1 ? "" : "s"}</span>;
}

// ─── Modais ──────────────────────────────────────────────────────────────────
function Shell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2d45]">
          <h2 className="text-white font-bold text-sm">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#1e2d45]">{footer}</div>
      </div>
    </div>
  );
}
const inputCls = "w-full bg-[#161f30] border border-[#2a3d56] rounded-lg px-3 py-2 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500";
const lblCls = "block text-xs text-slate-400 font-medium mb-1";

function CategoryModal({ scope, initial, busy, onClose, onSubmit }: {
  scope: "GLOBAL" | "COMPANY"; initial: Category | null; busy: boolean; onClose: () => void;
  onSubmit: (payload: any) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  return (
    <Shell title={initial ? "Editar trilha" : "Nova trilha"} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
        <button disabled={busy || !title.trim()} onClick={() => onSubmit({ title: title.trim(), emoji, description, active })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {busy ? "Salvando..." : "Salvar"}
        </button>
      </>}>
      <div className="flex gap-3">
        <div className="w-20">
          <label className={lblCls}>Ícone</label>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🎬" maxLength={4} className={inputCls + " text-center text-lg"} />
        </div>
        <div className="flex-1">
          <label className={lblCls}>Nome da trilha *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Primeiros passos" className={inputCls} />
        </div>
      </div>
      <div>
        <label className={lblCls}>Descrição (opcional)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Aparece abaixo do nome da fileira." className={inputCls + " resize-y"} />
      </div>
      {initial && (
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-indigo-500" />
          <span className="text-sm text-slate-300">Trilha visível pros clientes</span>
        </label>
      )}
      {!initial && (
        <p className="text-[11px] text-slate-500">
          {scope === "GLOBAL"
            ? "Depois de criar, use “Liberar” pra escolher quais empresas veem esta trilha."
            : "Depois de criar, use “Liberar” pra escolher quais clientes veem esta trilha."}
        </p>
      )}
    </Shell>
  );
}

function VideoModal({ initial, busy, onClose, onSubmit }: {
  initial: Video | null; busy: boolean; onClose: () => void; onSubmit: (payload: any) => void;
}) {
  const [url, setUrl] = useState(initial ? `https://youtu.be/${initial.youtubeId}` : "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [durationLabel, setDurationLabel] = useState(initial?.durationLabel ?? "");
  const id = ytId(url);
  const valid = !!id && !!title.trim();
  return (
    <Shell title={initial ? "Editar vídeo" : "Adicionar vídeo"} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
        <button disabled={busy || !valid} onClick={() => onSubmit({ url, title: title.trim(), description, durationLabel })}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {busy ? "Salvando..." : initial ? "Salvar" : "Adicionar"}
        </button>
      </>}>
      <div>
        <label className={lblCls}>Link do YouTube *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/... ou link completo" className={inputCls} />
        {url && !id && <p className="text-[11px] text-red-400 mt-1">Não reconheci o link. Cole a URL do vídeo do YouTube.</p>}
      </div>
      {id && (
        <div className="rounded-lg overflow-hidden border border-[#1e2d45] aspect-video bg-black max-w-[240px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="prévia" className="w-full h-full object-cover" />
        </div>
      )}
      <div>
        <label className={lblCls}>Título *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Como configurar seu perfil" className={inputCls} />
      </div>
      <div>
        <label className={lblCls}>Descrição (opcional)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls + " resize-y"} />
      </div>
      <div className="w-32">
        <label className={lblCls}>Duração (opcional)</label>
        <input value={durationLabel} onChange={(e) => setDurationLabel(e.target.value)} placeholder="12:34" className={inputCls} />
      </div>
    </Shell>
  );
}

function ReleaseModal({ cat, companies, scope, busy, onClose, onSubmit }: {
  cat: Category; companies: CompanyOpt[]; scope: "GLOBAL" | "COMPANY"; busy: boolean;
  onClose: () => void; onSubmit: (visibility: "ALL" | "SELECTED", ids: string[]) => void;
}) {
  const [visibility, setVisibility] = useState<"ALL" | "SELECTED">(cat.visibility);
  const [selected, setSelected] = useState<Set<string>>(new Set(cat.releaseCompanyIds));
  const [q, setQ] = useState("");
  const filtered = companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  return (
    <Shell title={`Liberar “${cat.title}”`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
        <button disabled={busy} onClick={() => onSubmit(visibility, [...selected])}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          {busy ? "Salvando..." : "Salvar liberação"}
        </button>
      </>}>
      <div className="flex flex-col gap-2">
        <button onClick={() => setVisibility("ALL")}
          className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${visibility === "ALL" ? "border-emerald-500/60 bg-emerald-500/10" : "border-[#2a3d56] hover:border-slate-500"}`}>
          <div className="flex items-center gap-2 text-sm font-medium text-white"><Eye className="w-4 h-4 text-emerald-400" /> Todos os clientes</div>
          <p className="text-xs text-slate-500 mt-0.5 pl-6">{scope === "GLOBAL" ? "Toda empresa com o módulo de Vídeos vê esta trilha." : "Todos os seus clientes veem esta trilha."}</p>
        </button>
        <button onClick={() => setVisibility("SELECTED")}
          className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${visibility === "SELECTED" ? "border-indigo-500/60 bg-indigo-500/10" : "border-[#2a3d56] hover:border-slate-500"}`}>
          <div className="flex items-center gap-2 text-sm font-medium text-white"><Users className="w-4 h-4 text-indigo-400" /> Só empresas selecionadas</div>
          <p className="text-xs text-slate-500 mt-0.5 pl-6">Escolha abaixo quem vê.</p>
        </button>
      </div>

      {visibility === "SELECTED" && (
        <div className="border border-[#1e2d45] rounded-lg overflow-hidden">
          <div className="p-2 border-b border-[#1e2d45]">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa..." className={inputCls + " py-1.5 text-xs"} />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <p className="px-3 py-4 text-xs text-slate-500 text-center">Nenhuma empresa {scope === "COMPANY" ? "cliente" : "com acesso"} encontrada.</p>}
            {filtered.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4 accent-indigo-500" />
                <span className="text-sm text-slate-200 truncate">{c.name}</span>
              </label>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-[#1e2d45] text-[11px] text-slate-500">{selected.size} selecionada{selected.size === 1 ? "" : "s"}</div>
        </div>
      )}
    </Shell>
  );
}

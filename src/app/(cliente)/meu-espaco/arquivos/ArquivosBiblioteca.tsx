"use client";

import { useMemo, useState } from "react";
import { linkKind, isImageMime, fileEmoji } from "@/lib/link-kind";

export type LibItem = {
  id: string;
  folder: string;
  kind: "LINK" | "FILE";
  title: string;
  description: string | null;
  url: string | null;
  createdAt: string;
  file: { id: string; fileName: string; mimeType: string; size: number } | null;
};

const fmtData = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Tira acento pra busca achar "logo" em "Lógos", "video" em "Vídeos"…
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function ArquivosBiblioteca({ items }: { items: LibItem[] }) {
  const [folder, setFolder] = useState<string>("__all");
  const [q, setQ] = useState("");

  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.folder, (m.get(it.folder) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [items]);

  const filtered = useMemo(() => {
    const term = norm(q.trim());
    return items.filter((it) => {
      if (folder !== "__all" && it.folder !== folder) return false;
      if (!term) return true;
      return [it.title, it.description, it.folder, it.file?.fileName, it.url]
        .some((v) => v && norm(v).includes(term));
    });
  }, [items, folder, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, LibItem[]>();
    for (const it of filtered) (m.get(it.folder) ?? m.set(it.folder, []).get(it.folder)!).push(it);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [filtered]);

  if (items.length === 0) {
    return (
      <div className="arq">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="aempty">Ainda não há arquivos por aqui. Assim que a equipe separar seus materiais, eles aparecem nesta página.</div>
      </div>
    );
  }

  return (
    <div className="arq">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="asearch">
        <span>🔎</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar arquivos, links, pastas…" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Limpar busca">×</button>}
      </div>

      <div className="afolders">
        <button type="button" className={folder === "__all" ? "on" : ""} onClick={() => setFolder("__all")}>
          Todas <i>{items.length}</i>
        </button>
        {folders.map(([f, n]) => (
          <button key={f} type="button" className={folder === f ? "on" : ""} onClick={() => setFolder(f)}>
            📁 {f} <i>{n}</i>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="aempty">Nada encontrado para “{q}”.</div>
      ) : (
        grouped.map(([f, list]) => (
          <section key={f} className="asec">
            {folder === "__all" && <h2>📁 {f}</h2>}
            <div className="agrid">
              {list.map((it) => <Card key={it.id} it={it} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Card({ it }: { it: LibItem }) {
  const isFile = it.kind === "FILE" && !!it.file;
  const openUrl = isFile ? `/api/storage/${it.file!.id}` : it.url ?? "#";
  const lk = isFile ? null : linkKind(it.url);
  const img = isFile && isImageMime(it.file!.mimeType);
  return (
    <div className="acard">
      <a className="athumb" href={openUrl} target="_blank" rel="noopener noreferrer" title={it.title}>
        {img ? <img src={openUrl} alt={it.title} loading="lazy" /> : <span>{lk ? lk.icon : fileEmoji(it.file?.mimeType, it.file?.fileName)}</span>}
      </a>
      <div className="abody">
        <a className="atitle" href={openUrl} target="_blank" rel="noopener noreferrer" title={it.title}>{it.title}</a>
        <div className="ameta">
          {lk ? lk.label : `${it.file!.fileName.split(".").pop()?.toUpperCase() ?? "ARQUIVO"} · ${fmtSize(it.file!.size)}`}
          {" · "}{fmtData(it.createdAt)}
        </div>
        {it.description && <p className="adesc">{it.description}</p>}
        <div className="aact">
          {isFile ? (
            <>
              <a className="abtn" href={`/api/storage/${it.file!.id}?download=1`}>⬇ Baixar</a>
              <a className="alk" href={openUrl} target="_blank" rel="noopener noreferrer">Abrir</a>
            </>
          ) : (
            <a className="abtn" href={openUrl} target="_blank" rel="noopener noreferrer">Abrir link ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.arq{--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);color:var(--ink)}
.arq *{box-sizing:border-box}
.asearch{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:14px;border:1px solid var(--line2);background:rgba(255,255,255,.04);margin-bottom:14px}
.asearch input{flex:1;background:transparent;border:0;outline:0;color:var(--ink);font-size:14.5px}
.asearch input::placeholder{color:var(--ink3)}
.asearch button{background:none;border:0;color:var(--ink3);font-size:18px;cursor:pointer;line-height:1}
.afolders{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.afolders button{font-size:12.5px;font-weight:650;color:var(--ink2);background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:99px;padding:6px 12px;cursor:pointer}
.afolders button i{font-style:normal;font-size:11px;color:var(--ink3);margin-left:4px}
.afolders button.on{color:#fff;background:linear-gradient(135deg,rgba(110,134,255,.35),rgba(155,123,255,.3));border-color:rgba(110,134,255,.55)}
.asec{margin-bottom:26px}
.asec h2{margin:0 2px 12px;font-size:15px;font-weight:740}
.agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.acard{display:flex;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))}
.athumb{width:78px;height:78px;border-radius:10px;overflow:hidden;flex:none;display:grid;place-items:center;background:rgba(255,255,255,.04);border:1px solid var(--line);font-size:30px;text-decoration:none}
.athumb img{width:100%;height:100%;object-fit:cover}
.abody{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.atitle{font-size:14px;font-weight:650;color:var(--ink);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atitle:hover{color:#AFC0FF}
.ameta{font-size:11.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.adesc{margin:3px 0 0;font-size:12.5px;color:var(--ink2);line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.aact{display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:8px}
.abtn{font-size:12px;font-weight:660;color:#fff;text-decoration:none;padding:6px 12px;border-radius:8px;background:linear-gradient(135deg,#6E86FF,#9B7BFF)}
.alk{font-size:12px;font-weight:650;color:#AFC0FF;text-decoration:none}
.aempty{color:var(--ink3);font-size:14px;padding:22px;border:1px dashed var(--line2);border-radius:14px;text-align:center}
`;

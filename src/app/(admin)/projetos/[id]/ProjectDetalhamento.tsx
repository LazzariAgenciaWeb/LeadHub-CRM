"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Heading2, List, ListOrdered, ListChecks, FileText, Pencil, X } from "lucide-react";
import { MarkdownDoc, toggleCheckLine } from "@/components/MarkdownDoc";
import { HtmlDoc, looksLikeHtml, htmlCheckProgress, toggleHtmlCheck } from "@/components/HtmlDoc";

/**
 * Detalhamento do projeto: o que foi vendido e o que precisa ser feito.
 *
 * Mora em SetorClickupList.description, como markdown leve (títulos, **negrito**,
 * listas e checklist "- [ ]") ou HTML colado (tabela, cores, checkbox) — o HTML
 * passa pela lista branca do HtmlDoc. Escrito na Configuração e lido no topo do
 * projeto — e pelo assistente (ver_detalhamento_projeto), que busca o escopo
 * daqui antes de opinar sobre o projeto.
 */

/** Estilo do markdown renderizado (MarkdownDoc não traz CSS próprio). */
export const MD_CLASS =
  "text-sm text-slate-200 leading-relaxed space-y-2 break-words " +
  "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-3 " +
  "[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-slate-100 [&_h4]:text-sm [&_h4]:text-slate-300 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5 " +
  "[&_li:has(.md-check)]:list-none [&_li:has(.md-check)]:-ml-5 " +
  "[&_.md-check]:text-indigo-300 [&_.md-done]:line-through [&_.md-done]:text-slate-500 " +
  "[&_strong]:text-white [&_strong]:font-semibold [&_a]:text-indigo-300 [&_a]:underline [&_a]:break-all " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500/40 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 " +
  "[&_code]:bg-[#111827] [&_code]:px-1 [&_code]:rounded [&_hr]:border-[#1e2d45] " +
  // Extras do HTML colado: tabela, imagem, checkbox, details.
  "[&_em]:italic [&_i]:italic [&_u]:underline [&_mark]:bg-amber-400/30 [&_mark]:text-amber-100 [&_mark]:rounded [&_mark]:px-0.5 " +
  "[&_h5]:text-xs [&_h5]:font-semibold [&_h5]:text-slate-300 [&_h6]:text-xs [&_h6]:text-slate-400 " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_caption]:text-slate-400 [&_caption]:text-xs [&_caption]:mb-1 " +
  "[&_th]:border [&_th]:border-[#1e2d45] [&_th]:bg-[#111827] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-white [&_th]:font-medium " +
  "[&_td]:border [&_td]:border-[#1e2d45] [&_td]:px-2 [&_td]:py-1 [&_td]:align-top " +
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_pre]:bg-[#111827] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto " +
  "[&_li:has(>.md-html-check)]:list-none [&_li:has(>.md-html-check)]:-ml-5 [&_.md-html-check]:mr-1.5 [&_.md-html-check]:accent-indigo-500 [&_.md-html-check]:align-middle " +
  "[&_details]:border [&_details]:border-[#1e2d45] [&_details]:rounded-lg [&_details]:px-3 [&_details]:py-2 [&_summary]:cursor-pointer [&_summary]:text-white";

const CHECK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/;

/** Quantos itens de checklist há e quantos estão feitos. */
function checkProgress(text: string): { total: number; feitos: number } {
  if (looksLikeHtml(text)) return htmlCheckProgress(text);
  let total = 0, feitos = 0;
  for (const l of text.split("\n")) {
    const m = CHECK_RE.exec(l);
    if (m) { total++; if (m[1] !== " ") feitos++; }
  }
  return { total, feitos };
}

/**
 * Mostra o detalhamento formatado: HTML (se o texto tiver tags) ou markdown.
 * Em ambos os casos o checklist marca direto e salva.
 */
function DetalhamentoView({ value, className, onToggle }: { value: string; className: string; onToggle: (next: string) => void }) {
  return looksLikeHtml(value)
    ? <HtmlDoc text={value} className={className} onToggleCheck={(i) => onToggle(toggleHtmlCheck(value, i))} />
    : <MarkdownDoc text={value} breaks className={className} onToggleCheck={(line) => onToggle(toggleCheckLine(value, line))} />;
}

// Prefixos de linha da barra de ferramentas.
const PREFIX = { h: "## ", ul: "- ", ol: "1. ", check: "- [ ] " } as const;
const ANY_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[(?: |x|X)\]\s+|[-*+]\s+|\d+[.)]\s+)/;

export function DetalhamentoEditor({
  value, onChange, onSave, startEditing = false, tall = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Chamado com o texto atual ao sair do campo (auto-salva sem botão) e ao marcar item. */
  onSave: (text: string) => void;
  /** Abre já na aba Escrever (com foco). */
  startEditing?: boolean;
  /** Ocupa a altura do modal grande. */
  tall?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"escrever" | "ver">(startEditing || !value.trim() ? "escrever" : "ver");
  // Abre com o cursor no fim, pronto pra acrescentar.
  useEffect(() => {
    const ta = ref.current;
    if (!startEditing || !ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [startEditing]);
  const pendingSel = useRef<[number, number] | null>(null);

  useEffect(() => {
    const s = pendingSel.current;
    if (s && ref.current) { ref.current.setSelectionRange(s[0], s[1]); pendingSel.current = null; }
  });

  function apply(next: string, selStart: number, selEnd: number) {
    pendingSel.current = [selStart, selEnd];
    onChange(next);
    requestAnimationFrame(() => ref.current?.focus());
  }

  /** **negrito** / _itálico_ em volta da seleção (ou insere o par vazio). */
  function wrap(mark: string) {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    const sel = value.slice(a, b);
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
      const inner = sel.slice(mark.length, sel.length - mark.length);
      apply(value.slice(0, a) + inner + value.slice(b), a, a + inner.length);
      return;
    }
    apply(value.slice(0, a) + mark + sel + mark + value.slice(b), a + mark.length, b + mark.length);
  }

  /** Liga/desliga o prefixo nas linhas da seleção (título, lista, checklist). */
  function linePrefix(kind: keyof typeof PREFIX) {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const endNl = value.indexOf("\n", b);
    const end = endNl === -1 ? value.length : endNl;
    const lines = value.slice(start, end).split("\n");
    const want = PREFIX[kind];
    const has = (l: string) => {
      const m = ANY_PREFIX.exec(l);
      if (!m) return false;
      const p = m[2];
      if (kind === "h") return p.startsWith("#");
      if (kind === "check") return /\[(?: |x|X)\]/.test(p);
      if (kind === "ol") return /^\d/.test(p);
      return /^[-*+]\s+$/.test(p);
    };
    const allHave = lines.filter((l) => l.trim()).every(has);
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(ANY_PREFIX, "$1");
      if (allHave) return bare;
      n++;
      const p = kind === "ol" ? `${n}. ` : want;
      return bare.replace(/^(\s*)/, `$1${p}`);
    });
    const block = out.join("\n");
    apply(value.slice(0, start) + block + value.slice(end), start, start + block.length);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("**"); return; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("_"); return; }
    if (e.key !== "Enter" || e.shiftKey || mod) return;
    // Enter numa linha de lista continua a lista; item vazio + Enter sai dela.
    const ta = e.currentTarget;
    const a = ta.selectionStart;
    if (a !== ta.selectionEnd) return;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const line = value.slice(start, a);
    const m = /^(\s*)([-*+]\s+\[(?: |x|X)\]\s+|[-*+]\s+|(\d+)([.)])\s+)/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[0].trim()) {
      apply(value.slice(0, start) + value.slice(a), start, start);
      return;
    }
    const next = m[3]
      ? `${m[1]}${Number(m[3]) + 1}${m[4]} `
      : `${m[1]}${m[2].replace(/\[(?:x|X)\]/, "[ ]")}`;
    const ins = `\n${next}`;
    apply(value.slice(0, a) + ins + value.slice(a), a + ins.length, a + ins.length);
  }

  const btn = "p-1.5 rounded hover:bg-[#1e2d45] text-slate-400 hover:text-white";
  return (
    <div className="rounded-lg border border-[#1e2d45] bg-[#080b12] focus-within:border-indigo-500">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[#1e2d45]">
        {tab === "escrever" && <>
          <button type="button" className={btn} title="Negrito (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("**")}><Bold className="w-3.5 h-3.5" /></button>
          <button type="button" className={btn} title="Itálico (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap("_")}><Italic className="w-3.5 h-3.5" /></button>
          <button type="button" className={btn} title="Título" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix("h")}><Heading2 className="w-3.5 h-3.5" /></button>
          <span className="w-px h-4 bg-[#1e2d45] mx-1" />
          <button type="button" className={btn} title="Lista com marcador" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix("ul")}><List className="w-3.5 h-3.5" /></button>
          <button type="button" className={btn} title="Lista numerada" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix("ol")}><ListOrdered className="w-3.5 h-3.5" /></button>
          <button type="button" className={btn} title="Checklist (o que deve ser feito)" onMouseDown={(e) => e.preventDefault()} onClick={() => linePrefix("check")}><ListChecks className="w-3.5 h-3.5" /></button>
        </>}
        <div className="ml-auto flex text-[11px]">
          {(["escrever", "ver"] as const).map((t) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              className={`px-2 py-0.5 rounded ${tab === t ? "bg-[#1e2d45] text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              {t === "escrever" ? "Escrever" : "Visualizar"}
            </button>
          ))}
        </div>
      </div>
      {tab === "escrever" ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => onSave(value)}
          rows={16}
          placeholder={"## O que foi vendido\n- Site institucional 5 páginas\n- 2 revisões\n\n## O que deve ser feito\n- [ ] Coletar textos e fotos\n- [ ] Layout da home"}
          className={`w-full bg-transparent px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none resize-y font-mono leading-relaxed ${tall ? "min-h-[55vh]" : "min-h-[16rem]"}`}
        />
      ) : (
        <div
          className={`px-3 py-2 cursor-text ${tall ? "min-h-[55vh]" : "min-h-[16rem]"}`}
          onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,summary")) setTab("escrever"); }}
          title="Clique pra editar"
        >
          {value.trim()
            ? <DetalhamentoView value={value} className={MD_CLASS} onToggle={(next) => { onChange(next); onSave(next); }} />
            : <p className="text-slate-600 text-sm">Nada escrito ainda — clique pra escrever.</p>}
        </div>
      )}
      <p className="px-3 py-1 border-t border-[#1e2d45] text-[10px] text-slate-600">
        **negrito** · _itálico_ · ## título · - item · - [ ] a fazer · Enter continua a lista · ou cole HTML (tabela, cores, &lt;input type=&quot;checkbox&quot;&gt;) · salva ao sair do campo
      </p>
    </div>
  );
}

/** Botão de destaque que abre o detalhamento (cabeçalho e card de vigência). */
export function DetalhamentoButton({ text, onOpen, size = "md" }: { text: string; onOpen: () => void; size?: "sm" | "md" }) {
  const vazio = !text.trim();
  const { total, feitos } = checkProgress(text);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors ${
        size === "sm" ? "text-xs px-2.5 py-1" : "text-sm px-3 py-1.5"
      } ${vazio
        ? "border border-dashed border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
        : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}
    >
      <FileText className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
      {vazio ? "Escrever detalhamento" : "Ver detalhamento"}
      {total > 0 && <span className={`text-[11px] ${vazio ? "" : "text-indigo-100/80"}`}>· {feitos}/{total}</span>}
    </button>
  );
}

/**
 * Modal grande (≈75% da tela) com o detalhamento: lê formatado, marca item do
 * checklist e alterna pra edição sem sair dali.
 */
export function DetalhamentoModal({
  open, onClose, title, value, onChange, onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string;
  onChange: (next: string) => void;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(!value.trim());
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;

  const { total, feitos } = checkProgress(value);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Detalhamento do projeto"
        className="w-full md:w-[75vw] max-w-6xl h-[90vh] md:h-[80vh] flex flex-col bg-[#0b111c] border border-[#1e2d45] rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[#1e2d45]">
          <FileText className="w-5 h-5 text-indigo-300 flex-none" />
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">Detalhamento · {title}</h2>
            <p className="text-[11px] text-slate-500">
              O que foi vendido e o que deve ser feito{total > 0 && <> · <span className="text-indigo-300">{feitos}/{total} feitos</span></>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (editing) onSave(value); setEditing((e) => !e); }}
              className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
                editing ? "bg-indigo-600 hover:bg-indigo-500 text-white" : "border border-[#1e2d45] text-slate-300 hover:text-white"
              }`}
            >
              {editing ? <>Concluir edição</> : <><Pencil className="w-3.5 h-3.5" /> Editar</>}
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-white" aria-label="Fechar"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {editing ? (
            <DetalhamentoEditor value={value} onChange={onChange} onSave={onSave} startEditing tall />
          ) : value.trim() ? (
            <DetalhamentoView
              value={value}
              className={`${MD_CLASS} text-[15px] ${looksLikeHtml(value) ? "" : "max-w-3xl"}`}
              onToggle={(next) => { onChange(next); onSave(next); }}
            />
          ) : (
            <p className="text-slate-500 text-sm">Nada escrito ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}

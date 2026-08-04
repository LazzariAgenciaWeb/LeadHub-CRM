"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Zap, Plus, Pencil, Trash2, X, Search, Users, User as UserIcon, ChevronLeft } from "lucide-react";

export type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  scope: "company" | "personal";
  mine: boolean;
  order: number;
};

type Vars = { nome: string; primeiroNome: string; atendente: string };

/**
 * Popover de Respostas Rápidas (atalhos de mensagem) — estilo WhatsApp Business.
 * Aberto pelo botão ⚡ do compositor OU pelo atalho "/" (initialQuery).
 * onInsert recebe o texto já com as variáveis resolvidas ({nome} etc).
 */
export default function QuickReplies({
  open,
  onClose,
  initialQuery = "",
  onInsert,
  vars,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  onInsert: (text: string) => void;
  vars: Vars;
  isAdmin: boolean;
}) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [form, setForm] = useState({ shortcut: "", title: "", body: "", scope: "personal" as "personal" | "company" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function fetchItems() {
    try {
      const res = await fetch("/api/quick-replies");
      if (res.ok) {
        const data = await res.json();
        setItems(data.quickReplies ?? []);
      }
    } finally {
      setLoaded(true);
    }
  }

  // Carrega ao abrir a primeira vez; sincroniza a busca com o atalho "/"
  useEffect(() => {
    if (open && !loaded) fetchItems();
    if (open) {
      setQ(initialQuery);
      setView("list");
      setTimeout(() => searchRef.current?.focus(), 30);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  function resolve(text: string): string {
    return text
      .replace(/\{primeiroNome\}/gi, vars.primeiroNome || vars.nome || "")
      .replace(/\{nome\}/gi, vars.nome || "")
      .replace(/\{atendente\}/gi, vars.atendente || "");
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (i) =>
        i.shortcut.toLowerCase().includes(term) ||
        i.title.toLowerCase().includes(term) ||
        i.body.toLowerCase().includes(term),
    );
  }, [items, q]);

  const shared = filtered.filter((i) => i.scope === "company");
  const personal = filtered.filter((i) => i.scope === "personal");

  function pick(item: QuickReply) {
    onInsert(resolve(item.body));
    onClose();
  }

  function startNew() {
    setEditing(null);
    setForm({ shortcut: "", title: "", body: "", scope: "personal" });
    setError(null);
    setView("form");
  }

  function startEdit(item: QuickReply) {
    setEditing(item);
    setForm({ shortcut: item.shortcut, title: item.title, body: item.body, scope: item.scope });
    setError(null);
    setView("form");
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      setError("Preencha o título e a mensagem.");
      return;
    }
    setSaving(true);
    setError(null);
    const url = editing ? `/api/quick-replies/${editing.id}` : "/api/quick-replies";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Erro ao salvar.");
      return;
    }
    const d = await res.json();
    const saved: QuickReply = d.quickReply;
    setItems((prev) => (editing ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved]));
    setView("list");
  }

  async function remove(item: QuickReply) {
    if (!confirm(`Excluir "${item.title}"?`)) return;
    const res = await fetch(`/api/quick-replies/${item.id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  if (!open) return null;

  const Row = (item: QuickReply) => (
    <div
      key={item.id}
      className="group/qr flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
    >
      <button onClick={() => pick(item)} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-1.5">
          {item.shortcut && (
            <span className="text-[10px] font-mono font-semibold text-indigo-400 bg-indigo-500/10 px-1 rounded flex-shrink-0">
              /{item.shortcut}
            </span>
          )}
          <span className="text-xs font-medium text-slate-200 truncate">{item.title}</span>
        </div>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">{item.body}</p>
      </button>
      {(item.mine || (item.scope === "company" && isAdmin)) && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/qr:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={() => startEdit(item)} title="Editar" className="p-1 text-slate-500 hover:text-indigo-300">
            <Pencil className="w-3 h-3" strokeWidth={2.5} />
          </button>
          <button onClick={() => remove(item)} title="Excluir" className="p-1 text-slate-500 hover:text-rose-400">
            <Trash2 className="w-3 h-3" strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={popRef}
      className="absolute left-0 bottom-full mb-2 w-80 max-w-[90vw] bg-[#0d1525] border border-indigo-500/30 rounded-2xl shadow-2xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e2d45]">
        <div className="flex items-center gap-1.5">
          {view === "form" && (
            <button onClick={() => setView("list")} className="text-slate-500 hover:text-slate-200">
              <ChevronLeft className="w-4 h-4" strokeWidth={2.5} />
            </button>
          )}
          <Zap className="w-3.5 h-3.5 text-indigo-400" strokeWidth={2.5} />
          <span className="text-xs font-semibold text-indigo-200">
            {view === "form" ? (editing ? "Editar resposta" : "Nova resposta rápida") : "Respostas rápidas"}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 text-sm">✕</button>
      </div>

      {view === "list" && (
        <>
          {/* Busca */}
          <div className="px-3 pt-2.5 pb-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 top-1/2 -translate-y-1/2" strokeWidth={2.5} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por atalho ou título..."
                className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-64 overflow-y-auto px-1 pb-1">
            {!loaded && <p className="text-center text-slate-600 text-xs py-4">Carregando...</p>}
            {loaded && filtered.length === 0 && (
              <p className="text-center text-slate-600 text-xs py-4">
                {items.length === 0 ? "Nenhuma resposta ainda. Crie a primeira ↓" : "Nada encontrado."}
              </p>
            )}
            {shared.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                  <Users className="w-2.5 h-2.5" strokeWidth={2.5} /> Da empresa
                </div>
                {shared.map(Row)}
              </>
            )}
            {personal.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                  <UserIcon className="w-2.5 h-2.5" strokeWidth={2.5} /> Minhas
                </div>
                {personal.map(Row)}
              </>
            )}
          </div>

          {/* Nova */}
          <button
            onClick={startNew}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-[#1e2d45] text-xs font-medium text-indigo-300 hover:bg-indigo-500/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Nova resposta rápida
          </button>
        </>
      )}

      {view === "form" && (
        <div className="p-3 space-y-2.5">
          <div>
            <label className="block text-slate-500 text-[10px] mb-1">Atalho (opcional) — digite /atalho no campo pra usar rápido</label>
            <div className="flex items-center gap-1">
              <span className="text-slate-600 text-sm font-mono">/</span>
              <input
                value={form.shortcut}
                onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/\s+/g, "").toLowerCase() }))}
                placeholder="bomdia"
                className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-slate-500 text-[10px] mb-1">Título</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Saudação inicial"
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-slate-500 text-[10px] mb-1">Mensagem</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Olá {primeiroNome}, tudo bem? Sou da equipe..."
              rows={4}
              className="w-full bg-[#0f1623] border border-[#1e2d45] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <p className="text-[9px] text-slate-600 mt-1">
              Variáveis: <span className="text-indigo-400 font-mono">{"{nome}"}</span>{" "}
              <span className="text-indigo-400 font-mono">{"{primeiroNome}"}</span>{" "}
              <span className="text-indigo-400 font-mono">{"{atendente}"}</span> — preenchem sozinhas ao inserir.
            </p>
          </div>
          {/* Escopo */}
          <div>
            <label className="block text-slate-500 text-[10px] mb-1">Quem usa</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setForm((f) => ({ ...f, scope: "personal" }))}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                  form.scope === "personal"
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white"
                }`}
              >
                <UserIcon className="w-3 h-3" strokeWidth={2.5} /> Só minha
              </button>
              <button
                onClick={() => isAdmin && setForm((f) => ({ ...f, scope: "company" }))}
                disabled={!isAdmin}
                title={isAdmin ? "" : "Só administradores criam respostas da empresa"}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  form.scope === "company"
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-[#0f1623] border-[#1e2d45] text-slate-400 hover:text-white"
                }`}
              >
                <Users className="w-3 h-3" strokeWidth={2.5} /> Da empresa
              </button>
            </div>
          </div>

          {error && <p className="text-rose-400 text-[11px]">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar"}
            </button>
            <button
              onClick={() => setView("list")}
              className="px-3 py-1.5 rounded-lg bg-[#0f1623] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

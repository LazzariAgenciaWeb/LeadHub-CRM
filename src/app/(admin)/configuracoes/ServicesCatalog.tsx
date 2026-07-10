"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Eye, Lock, Package, Tag } from "lucide-react";

interface Service {
  id: string;
  name: string;
  description: string | null;
  qualifyingQuestions: string | null;
  salesArguments: string | null;
  references: string | null;
  priceRange: string | null;
  isActive: boolean;
  showInClientArea: boolean;
  order: number;
}

const QUESTIONS_PLACEHOLDER = `Uma pergunta por linha. Ex.:
Você já tem um site ou vamos começar do zero?
Qual o principal objetivo do site?
Quais páginas você imagina incluir?`;

export default function ServicesCatalog({
  companyId,
  initialServices,
}: {
  companyId: string;
  initialServices: Service[];
}) {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>(initialServices);
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fQuestions, setFQuestions] = useState("");
  const [fArgs, setFArgs] = useState("");
  const [fRefs, setFRefs] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fActive, setFActive] = useState(true);
  const [fShowClient, setFShowClient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openNew() {
    setEditing("new");
    setFName(""); setFDesc(""); setFQuestions(""); setFArgs(""); setFRefs(""); setFPrice(""); setFActive(true); setFShowClient(false); setErr(null);
  }
  function openEdit(s: Service) {
    setEditing(s);
    setFName(s.name); setFDesc(s.description ?? ""); setFQuestions(s.qualifyingQuestions ?? "");
    setFArgs(s.salesArguments ?? ""); setFRefs(s.references ?? ""); setFPrice(s.priceRange ?? "");
    setFActive(s.isActive); setFShowClient(s.showInClientArea); setErr(null);
  }
  function closeForm() { setEditing(null); setErr(null); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const payload: any = {
      companyId, name: fName, description: fDesc, qualifyingQuestions: fQuestions,
      salesArguments: fArgs, references: fRefs, priceRange: fPrice, isActive: fActive,
      showInClientArea: fShowClient,
    };
    const isNew = editing === "new";
    const url = isNew ? "/api/ai/services" : `/api/ai/services/${(editing as Service).id}`;
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error ?? "Erro ao salvar"); return;
    }
    closeForm();
    router.refresh();
    const fresh = await fetch(`/api/ai/services?companyId=${companyId}`).then((r) => r.json()).catch(() => null);
    if (Array.isArray(fresh)) setServices(fresh);
  }

  async function remove(s: Service) {
    if (!confirm(`Excluir o serviço "${s.name}"?`)) return;
    const res = await fetch(`/api/ai/services/${s.id}`, { method: "DELETE" });
    if (res.ok) {
      setServices((prev) => prev.filter((x) => x.id !== s.id));
      router.refresh();
    }
  }

  const inputCls = "w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";
  const tagCls = "ml-1.5 align-middle inline-flex items-center gap-1 text-[9px] font-semibold normal-case tracking-normal px-1.5 py-0.5 rounded";
  const iaTag  = <span className={`${tagCls} bg-indigo-500/15 text-indigo-300`} title="O agente de IA usa este campo"><Bot className="w-3 h-3" strokeWidth={2.25} /> IA</span>;
  const cliTag = <span className={`${tagCls} bg-emerald-500/15 text-emerald-400`} title="Aparece pro cliente em 'Disponível para você'"><Eye className="w-3 h-3" strokeWidth={2.25} /> Cliente</span>;
  const intTag = <span className={`${tagCls} bg-amber-500/15 text-amber-400`} title="Uso interno — não vai pra IA nem pro cliente"><Lock className="w-3 h-3" strokeWidth={2.25} /> Interno</span>;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-sm flex items-center gap-1.5"><Tag className="w-4 h-4 text-indigo-400" strokeWidth={2.25} /> Catálogo de Serviços</h2>
          <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            <span>Um catálogo só, usado em dois lugares:</span>
            <span className="inline-flex items-center gap-1 text-indigo-300"><Bot className="w-3.5 h-3.5" strokeWidth={2.25} /> IA usa</span>·
            <span className="inline-flex items-center gap-1 text-emerald-400"><Eye className="w-3.5 h-3.5" strokeWidth={2.25} /> aparece pro cliente</span>·
            <span className="inline-flex items-center gap-1 text-amber-400"><Lock className="w-3.5 h-3.5" strokeWidth={2.25} /> só você vê</span>
          </p>
        </div>
        {editing === null && (
          <button onClick={openNew} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 whitespace-nowrap">
            + Novo serviço
          </button>
        )}
      </div>

      {editing !== null && (
        <form onSubmit={save} className="bg-[#0f1623] border border-indigo-500/30 rounded-xl p-5 space-y-4">
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Nome do serviço {iaTag}{cliTag}</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Ex.: Criação de Sites" className={inputCls} />
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Descrição <span className="text-slate-600 normal-case">(opcional)</span> {iaTag}{cliTag}</label>
            <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} rows={2} placeholder="Resumo curto do que é o serviço" className={`${inputCls} resize-y`} />
          </div>
          <div>
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Perguntas de qualificação <span className="text-slate-600 normal-case">(uma por linha)</span> {iaTag}</label>
            <textarea value={fQuestions} onChange={(e) => setFQuestions(e.target.value)} rows={6} placeholder={QUESTIONS_PLACEHOLDER} className={`${inputCls} resize-y leading-relaxed`} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Argumentos <span className="text-slate-600 normal-case">(opcional)</span> {iaTag}</label>
              <textarea value={fArgs} onChange={(e) => setFArgs(e.target.value)} rows={4} placeholder="Como apresentar / diferenciais" className={`${inputCls} resize-y`} />
            </div>
            <div>
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Referências / cases <span className="text-slate-600 normal-case">(opcional)</span> {iaTag}</label>
              <textarea value={fRefs} onChange={(e) => setFRefs(e.target.value)} rows={4} placeholder="Links, cases, materiais" className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">
                Faixa de preço {intTag}
              </label>
              <input value={fPrice} onChange={(e) => setFPrice(e.target.value)} placeholder="Ex.: R$ 2.000 a R$ 5.000" className={inputCls} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 pb-2.5 cursor-pointer whitespace-nowrap" title="A IA/SDR pode indicar este serviço">
              <input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} className="accent-indigo-500" />
              Ativo (IA)
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={fShowClient} onChange={(e) => setFShowClient(e.target.checked)} className="accent-indigo-500" />
            <span>Mostrar pro cliente <span className="text-slate-500 text-xs">(aparece em "Disponível para você" no painel do cliente)</span></span>
          </label>

          {err && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</div>}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">
              {saving ? "Salvando..." : editing === "new" ? "Criar serviço" : "Salvar"}
            </button>
            <button type="button" onClick={closeForm} className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm hover:bg-[#1e2d45]">Cancelar</button>
          </div>
        </form>
      )}

      {services.length === 0 && editing === null && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 text-center">
          <p className="text-slate-400 text-sm">Nenhum serviço cadastrado.</p>
          <p className="text-slate-600 text-xs mt-1">Cadastre seus serviços (ex.: Sites, Redes Sociais, Marketing) pra o agente saber o que oferecer.</p>
        </div>
      )}

      {services.map((s) => (
        <div key={s.id} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#161f30] flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-slate-400" strokeWidth={2} /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-sm">{s.name}</span>
              {!s.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">inativo</span>}
              {s.showInClientArea && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 inline-flex items-center gap-1"><Eye className="w-2.5 h-2.5" strokeWidth={2.5} /> cliente</span>}
              {s.priceRange && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">💲 {s.priceRange}</span>}
            </div>
            {s.description && <p className="text-slate-500 text-xs mt-1 line-clamp-2">{s.description}</p>}
            {s.qualifyingQuestions && (
              <p className="text-slate-600 text-[11px] mt-1">
                {s.qualifyingQuestions.split("\n").filter(Boolean).length} pergunta(s) de qualificação
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => openEdit(s)} className="px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-xs hover:bg-[#1e2d45]">Editar</button>
            <button onClick={() => remove(s)} className="px-2.5 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-red-400 text-xs hover:bg-red-500/10">Excluir</button>
          </div>
        </div>
      ))}
    </section>
  );
}

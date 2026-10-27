"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Check, Copy, ExternalLink, Eye, EyeOff, ImagePlus, Loader2,
  Plus, Smartphone, Trash2, X,
} from "lucide-react";
import BioPageView, { type BioViewData } from "@/app/p/[slug]/BioPageView";
import {
  BIO_DEFAULT_QUIZ_CTA, BIO_DEFAULT_QUIZ_TITLE, BIO_DEFAULT_THANK_YOU, BIO_LIMITS, BIO_NETWORKS,
  bioAccent, safeBioHref,
  type BioEditorBlock, type BioEditorInput, type BioEditorQuestion,
} from "@/lib/bio-page";

type Initial = BioEditorInput & { id: string; publishedAt: string | null };
type Block = BioEditorBlock & { _key: string };
type Question = BioEditorQuestion & { _key: string };
type Draft = Omit<Initial, "blocks" | "questions"> & { blocks: Block[]; questions: Question[] };

const inputCls = "w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";
const labelCls = "block text-slate-400 text-[11px] font-semibold mb-1";

const NETWORK_LABEL: Record<(typeof BIO_NETWORKS)[number], string> = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn",
  whatsapp: "WhatsApp", email: "E-mail", telefone: "Telefone", site: "Site",
};

const COLORS = ["#4f46e5", "#0f766e", "#16a34a", "#e11d48", "#ea580c", "#9333ea", "#0369a1", "#111827"];

const STEPS = ["Sua página", "Itens", "Perguntas", "Publicar"] as const;

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function toDraft(p: Initial): Draft {
  return {
    ...p,
    blocks: p.blocks.map((b) => ({ ...b, _key: b.id ?? newKey() })),
    questions: p.questions.map((q) => ({ ...q, _key: q.id ?? newKey() })),
  };
}

/** Rascunho → o que a página pública recebe (mesmo saneamento do servidor). */
function toPreview(d: Draft, defaultConsent: string): BioViewData {
  return {
    slug: d.slug,
    template: d.template,
    title: d.title || "Nome do seu negócio",
    headline: d.headline,
    about: d.about,
    avatarUrl: safeBioHref(d.avatarUrl),
    coverUrl: safeBioHref(d.coverUrl),
    accent: bioAccent(d.accentColor),
    blocks: d.blocks
      .filter((b) => b.active && b.title.trim())
      .map((b) => ({
        id: b._key, type: b.type, title: b.title, description: b.description,
        href: safeBioHref(b.url), imageUrl: safeBioHref(b.imageUrl), priceLabel: b.priceLabel, network: b.network,
      }))
      .filter((b) => b.type === "SERVICE" || b.href),
    quiz: d.quizEnabled
      ? {
          title: d.quizTitle || BIO_DEFAULT_QUIZ_TITLE,
          cta: d.quizCta || BIO_DEFAULT_QUIZ_CTA,
          thankYou: d.thankYouMessage || BIO_DEFAULT_THANK_YOU,
          consent: d.consentText || defaultConsent,
          questions: d.questions
            .filter((q) => q.active && q.text.trim())
            .map((q) => ({ id: q._key, text: q.text, options: q.options.filter((o) => o.trim()) }))
            .filter((q) => q.options.length > 0),
        }
      : null,
  };
}

/** _key é só da tela (chave do React); o servidor usa o id. */
function withoutKey<T extends { _key: string }>(x: T): Omit<T, "_key"> {
  const copy: Partial<T> = { ...x };
  delete copy._key;
  return copy as Omit<T, "_key">;
}

function strip(d: Draft) {
  const { blocks, questions, ...rest } = d;
  return {
    ...rest,
    blocks: blocks.map(withoutKey),
    questions: questions.map(withoutKey),
  };
}

// ─── Imagem: reduz no navegador e sobe ───────────────────────────────────────

async function shrink(file: File, maxSide: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Não deu pra ler a imagem."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
    if (blob && blob.type === "image/webp") return blob;
    const jpg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!jpg) throw new Error("Não deu pra preparar a imagem.");
    return jpg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ImageField({
  label, value, onChange, uploadsEnabled, maxSide, round = false,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  uploadsEnabled: boolean;
  maxSide: number;
  round?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = safeBioHref(value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await shrink(file, maxSide);
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "imagem.webp" : "imagem.jpg");
      const res = await fetch("/api/pagina/imagem", { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não deu pra enviar a imagem.");
      onChange(j.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não deu pra enviar a imagem.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex items-start gap-3">
        <div className={`w-14 h-14 flex-shrink-0 overflow-hidden bg-[#161f30] border border-[#1e2d45] ${round ? "rounded-full" : "rounded-lg"}`}>
          {shown && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-2">
            {uploadsEnabled && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-xs text-slate-200 hover:border-indigo-500 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                Enviar imagem
              </button>
            )}
            {value && (
              <button type="button" onClick={() => onChange(null)} className="text-xs text-slate-500 hover:text-red-400">
                Remover
              </button>
            )}
          </div>
          <input
            className={inputCls}
            placeholder={uploadsEnabled ? "…ou cole o link de uma imagem" : "Cole o link de uma imagem (https://…)"}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export default function PaginaEditor({
  initial, publicBase, uploadsEnabled, defaultConsent, hasBottomNav,
}: {
  initial: Initial;
  publicBase: string;
  uploadsEnabled: boolean;
  defaultConsent: string;
  /** Barra inferior do sistema no celular (o cliente da linha Página não tem). */
  hasBottomNav: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [saved, setSaved] = useState<Draft>(() => toDraft(initial));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const dirty = useMemo(() => JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved)), [draft, saved]);
  const preview = useMemo(() => toPreview(draft, defaultConsent), [draft, defaultConsent]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save(overrides: Partial<Draft> = {}) {
    const next = { ...draft, ...overrides };
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pagina", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strip(next)),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Não deu pra salvar.");
        return false;
      }
      const fresh = toDraft(j.page);
      setDraft(fresh);
      setSaved(fresh);
      setNotice("Salvo.");
      return true;
    } catch {
      setError("Sem conexão. Tente de novo.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const publicUrl = `${publicBase}${saved.slug}`;

  return (
    <div className="p-4 lg:p-6 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-white font-bold text-xl">Página do Negócio</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Seu link na bio: apresentação, serviços e perguntas que transformam visita em contato.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-md border ${saved.published ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" : "bg-slate-500/15 text-slate-300 border-slate-500/25"}`}>
            {saved.published ? "Publicada" : "Rascunho"}
          </span>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-xs text-slate-200"
          >
            <Smartphone className="w-3.5 h-3.5" /> Prévia
          </button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-2xl">
          {/* Passos */}
          <div className="flex bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5 mb-4 overflow-x-auto">
            {STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(i)}
                className={`flex-1 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${step === i ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {i + 1}. {label}
              </button>
            ))}
          </div>

          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 space-y-4">
            {step === 0 && <StepBasics draft={draft} set={set} uploadsEnabled={uploadsEnabled} />}
            {step === 1 && <StepBlocks draft={draft} set={set} uploadsEnabled={uploadsEnabled} />}
            {step === 2 && <StepQuiz draft={draft} set={set} defaultConsent={defaultConsent} />}
            {step === 3 && (
              <StepPublish
                draft={draft}
                saved={saved}
                set={set}
                publicBase={publicBase}
                publicUrl={publicUrl}
                saving={saving}
                copied={copied}
                onCopy={async () => {
                  await navigator.clipboard.writeText(publicUrl).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                onPublish={(published) => save({ published })}
              />
            )}
          </div>

          <div className="flex justify-between mt-3">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-0"
            >
              ← Voltar
            </button>
            {step < STEPS.length - 1 && (
              <button type="button" onClick={() => setStep((s) => s + 1)} className="px-3 py-1.5 text-xs text-indigo-300 hover:text-white">
                Próximo: {STEPS[step + 1]} →
              </button>
            )}
          </div>
        </div>

        {/* Prévia (desktop) */}
        <div className="hidden lg:block sticky top-6 flex-shrink-0">
          <PhoneFrame data={preview} />
        </div>
      </div>

      {/* Barra de salvar */}
      <div className={`fixed ${hasBottomNav ? "bottom-16" : "bottom-0"} lg:bottom-0 left-0 lg:left-[220px] right-0 z-20 bg-[#0b111c]/95 backdrop-blur border-t border-[#1e2d45] px-4 py-3 flex items-center gap-3`}>
        <p className="flex-1 min-w-0 text-xs truncate">
          {error ? <span className="text-red-400">{error}</span>
            : dirty ? <span className="text-amber-300">Alterações não salvas</span>
            : notice ? <span className="text-emerald-300">{notice}</span>
            : <span className="text-slate-500">Tudo salvo</span>}
        </p>
        <button
          type="button"
          onClick={() => save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      </div>

      {/* Prévia (celular) */}
      {showPreview && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <button type="button" className="self-end mb-2 text-white" aria-label="Fechar prévia">
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            <PhoneFrame data={preview} />
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneFrame({ data }: { data: BioViewData }) {
  return (
    <div>
      <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-2 text-center">Prévia</p>
      <div className="w-[340px] h-[640px] max-h-[75vh] rounded-[2rem] border-[6px] border-[#1e2d45] bg-[#f4f5f7] overflow-hidden">
        <div className="h-full overflow-y-auto relative">
          <BioPageView data={data} preview />
        </div>
      </div>
    </div>
  );
}

// ─── Passo 1: dados ──────────────────────────────────────────────────────────

type Setter = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

function StepBasics({ draft, set, uploadsEnabled }: { draft: Draft; set: Setter; uploadsEnabled: boolean }) {
  const L = BIO_LIMITS;
  return (
    <>
      <div>
        <label className={labelCls}>Nome do negócio</label>
        <input className={inputCls} maxLength={L.title} value={draft.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Frase curta (aparece embaixo do nome)</label>
        <input
          className={inputCls}
          maxLength={L.headline}
          placeholder="Ex.: Odontologia para a família toda em Maripá"
          value={draft.headline ?? ""}
          onChange={(e) => set("headline", e.target.value || null)}
        />
      </div>
      <div>
        <label className={labelCls}>Sobre (opcional)</label>
        <textarea
          className={`${inputCls} resize-y`}
          rows={3}
          maxLength={L.about}
          placeholder="Horário de atendimento, diferenciais, região que atende…"
          value={draft.about ?? ""}
          onChange={(e) => set("about", e.target.value || null)}
        />
      </div>
      <ImageField label="Foto ou logo" value={draft.avatarUrl} onChange={(v) => set("avatarUrl", v)} uploadsEnabled={uploadsEnabled} maxSide={512} round />
      <ImageField label="Capa (opcional)" value={draft.coverUrl} onChange={(v) => set("coverUrl", v)} uploadsEnabled={uploadsEnabled} maxSide={1200} />
      <div>
        <span className={labelCls}>Cor</span>
        <div className="flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              onClick={() => set("accentColor", c)}
              className={`w-7 h-7 rounded-full border-2 ${bioAccent(draft.accentColor).toLowerCase() === c ? "border-white" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Outra cor"
            value={bioAccent(draft.accentColor)}
            onChange={(e) => set("accentColor", e.target.value)}
            className="w-9 h-7 bg-transparent border border-[#1e2d45] rounded cursor-pointer"
          />
        </div>
      </div>
      <div>
        <span className={labelCls}>Modelo</span>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["CARTAO", "Cartão", "Foto, botões e serviços em lista."],
            ["VITRINE", "Vitrine", "Serviços em grade, com imagem."],
          ] as const).map(([value, name, desc]) => (
            <button
              key={value}
              type="button"
              onClick={() => set("template", value)}
              className={`text-left p-3 rounded-lg border transition-colors ${draft.template === value ? "border-indigo-500 bg-indigo-500/10" : "border-[#1e2d45] bg-[#161f30] hover:border-slate-500"}`}
            >
              <span className="block text-sm font-semibold text-white">{name}</span>
              <span className="block text-xs text-slate-400 mt-0.5">{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Passo 2: itens ──────────────────────────────────────────────────────────

const SECTIONS = [
  { type: "SOCIAL" as const, item: "Rede", title: "Redes sociais", hint: "Ícones no topo da página.", add: "Adicionar rede", max: BIO_LIMITS.socials },
  { type: "LINK" as const, item: "Link", title: "Links", hint: "Botões: site, cardápio, localização, WhatsApp…", add: "Adicionar link", max: BIO_LIMITS.links },
  { type: "SERVICE" as const, item: "Serviço", title: "Serviços", hint: "O que você oferece. Ao tocar, abre o detalhe com \"Tenho interesse\".", add: "Adicionar serviço", max: BIO_LIMITS.services },
];

function StepBlocks({ draft, set, uploadsEnabled }: { draft: Draft; set: Setter; uploadsEnabled: boolean }) {
  const blocks = draft.blocks;

  function update(key: string, patch: Partial<Block>) {
    set("blocks", blocks.map((b) => (b._key === key ? { ...b, ...patch } : b)));
  }
  function remove(key: string) {
    set("blocks", blocks.filter((b) => b._key !== key));
  }
  /** Troca com o vizinho do mesmo tipo (a lista mistura os três tipos). */
  function move(key: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b._key === key);
    let j = i + dir;
    while (j >= 0 && j < blocks.length && blocks[j].type !== blocks[i].type) j += dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set("blocks", next);
  }
  function add(type: Block["type"]) {
    set("blocks", [...blocks, {
      _key: newKey(), type, title: type === "SOCIAL" ? "Instagram" : "", description: null, url: null,
      imageUrl: null, priceLabel: null, network: type === "SOCIAL" ? "instagram" : null, active: true,
    }]);
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((sec) => {
        const items = blocks.filter((b) => b.type === sec.type);
        return (
          <section key={sec.type}>
            <h3 className="text-white text-sm font-semibold">{sec.title}</h3>
            <p className="text-slate-500 text-xs mb-2">{sec.hint}</p>
            <div className="space-y-2">
              {items.map((b, idx) => (
                <div key={b._key} className={`rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3 space-y-2 ${b.active ? "" : "opacity-60"}`}>
                  <div className="flex items-center gap-1">
                    <span className="flex-1 text-[11px] text-slate-500">{sec.item} {idx + 1}</span>
                    <IconBtn label="Subir" onClick={() => move(b._key, -1)} disabled={idx === 0}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label="Descer" onClick={() => move(b._key, 1)} disabled={idx === items.length - 1}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label={b.active ? "Ocultar" : "Mostrar"} onClick={() => update(b._key, { active: !b.active })}>
                      {b.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </IconBtn>
                    <IconBtn label="Apagar" onClick={() => remove(b._key)} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                  </div>

                  {sec.type === "SOCIAL" && (
                    <div className="grid grid-cols-[130px_1fr] gap-2">
                      <select
                        className={inputCls}
                        value={b.network ?? "site"}
                        onChange={(e) => update(b._key, { network: e.target.value, title: NETWORK_LABEL[e.target.value as keyof typeof NETWORK_LABEL] })}
                      >
                        {BIO_NETWORKS.map((n) => <option key={n} value={n}>{NETWORK_LABEL[n]}</option>)}
                      </select>
                      <input className={inputCls} placeholder="Link do perfil" value={b.url ?? ""} onChange={(e) => update(b._key, { url: e.target.value || null })} />
                    </div>
                  )}

                  {sec.type === "LINK" && (
                    <>
                      <div className="grid grid-cols-[1fr_130px] gap-2">
                        <input className={inputCls} placeholder="Texto do botão" maxLength={BIO_LIMITS.blockTitle} value={b.title} onChange={(e) => update(b._key, { title: e.target.value })} />
                        <select className={inputCls} value={b.network ?? ""} onChange={(e) => update(b._key, { network: e.target.value || null })}>
                          <option value="">Sem ícone</option>
                          {BIO_NETWORKS.map((n) => <option key={n} value={n}>{NETWORK_LABEL[n]}</option>)}
                        </select>
                      </div>
                      <input className={inputCls} placeholder="Link (https://…)" value={b.url ?? ""} onChange={(e) => update(b._key, { url: e.target.value || null })} />
                      <input className={inputCls} placeholder="Detalhe (opcional)" maxLength={BIO_LIMITS.blockDescription} value={b.description ?? ""} onChange={(e) => update(b._key, { description: e.target.value || null })} />
                    </>
                  )}

                  {sec.type === "SERVICE" && (
                    <>
                      <div className="grid grid-cols-[1fr_150px] gap-2">
                        <input className={inputCls} placeholder="Nome do serviço" maxLength={BIO_LIMITS.blockTitle} value={b.title} onChange={(e) => update(b._key, { title: e.target.value })} />
                        <input className={inputCls} placeholder="Preço (opcional)" maxLength={BIO_LIMITS.priceLabel} value={b.priceLabel ?? ""} onChange={(e) => update(b._key, { priceLabel: e.target.value || null })} />
                      </div>
                      <textarea className={`${inputCls} resize-y`} rows={2} placeholder="Descrição" maxLength={BIO_LIMITS.blockDescription} value={b.description ?? ""} onChange={(e) => update(b._key, { description: e.target.value || null })} />
                      <ImageField label="Imagem" value={b.imageUrl} onChange={(v) => update(b._key, { imageUrl: v })} uploadsEnabled={uploadsEnabled} maxSide={900} />
                      <input className={inputCls} placeholder="Link para saber mais (opcional)" value={b.url ?? ""} onChange={(e) => update(b._key, { url: e.target.value || null })} />
                    </>
                  )}
                </div>
              ))}
            </div>
            {items.length < sec.max && (
              <button type="button" onClick={() => add(sec.type)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white">
                <Plus className="w-3.5 h-3.5" /> {sec.add}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded-md text-slate-400 hover:bg-[#161f30] disabled:opacity-30 ${danger ? "hover:text-red-400" : "hover:text-white"}`}
    >
      {children}
    </button>
  );
}

// ─── Passo 3: perguntas ──────────────────────────────────────────────────────

function StepQuiz({ draft, set, defaultConsent }: { draft: Draft; set: Setter; defaultConsent: string }) {
  const L = BIO_LIMITS;
  const qs = draft.questions;

  function update(key: string, patch: Partial<Question>) {
    set("questions", qs.map((q) => (q._key === key ? { ...q, ...patch } : q)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    set("questions", next);
  }

  return (
    <>
      <label className="flex items-center gap-2 text-sm text-white">
        <input type="checkbox" checked={draft.quizEnabled} onChange={(e) => set("quizEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
        Mostrar as perguntas na página
      </label>
      <p className="text-slate-500 text-xs -mt-2">
        A pessoa responde tocando em botões e no fim deixa nome e telefone — o contato cai na sua lista de leads.
      </p>

      {draft.quizEnabled && (
        <>
          <div className="grid sm:grid-cols-[1fr_160px] gap-2">
            <div>
              <label className={labelCls}>Chamada</label>
              <input className={inputCls} maxLength={L.quizTitle} placeholder={BIO_DEFAULT_QUIZ_TITLE} value={draft.quizTitle ?? ""} onChange={(e) => set("quizTitle", e.target.value || null)} />
            </div>
            <div>
              <label className={labelCls}>Botão</label>
              <input className={inputCls} maxLength={L.quizCta} placeholder={BIO_DEFAULT_QUIZ_CTA} value={draft.quizCta ?? ""} onChange={(e) => set("quizCta", e.target.value || null)} />
            </div>
          </div>

          <div className="space-y-2">
            {qs.map((q, i) => (
              <div key={q._key} className={`rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3 space-y-2 ${q.active ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-1">
                  <span className="flex-1 text-[11px] text-slate-500">Pergunta {i + 1}</span>
                  <IconBtn label="Subir" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn label="Descer" onClick={() => move(i, 1)} disabled={i === qs.length - 1}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn label={q.active ? "Ocultar" : "Mostrar"} onClick={() => update(q._key, { active: !q.active })}>
                    {q.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </IconBtn>
                  <IconBtn label="Apagar" onClick={() => set("questions", qs.filter((x) => x._key !== q._key))} danger><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                </div>
                <input className={inputCls} maxLength={L.questionText} placeholder="Pergunta" value={q.text} onChange={(e) => update(q._key, { text: e.target.value })} />
                <div className="space-y-1.5 pl-3 border-l border-[#1e2d45]">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-1.5">
                      <input
                        className={inputCls}
                        maxLength={L.optionText}
                        placeholder={`Resposta ${oi + 1}`}
                        value={opt}
                        onChange={(e) => update(q._key, { options: q.options.map((o, k) => (k === oi ? e.target.value : o)) })}
                      />
                      <IconBtn label="Apagar resposta" onClick={() => update(q._key, { options: q.options.filter((_, k) => k !== oi) })} disabled={q.options.length <= L.optionsMin} danger>
                        <X className="w-3.5 h-3.5" />
                      </IconBtn>
                    </div>
                  ))}
                  {q.options.length < L.optionsMax && (
                    <button type="button" onClick={() => update(q._key, { options: [...q.options, ""] })} className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-white">
                      <Plus className="w-3 h-3" /> Resposta
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {qs.length < L.questions && (
            <button
              type="button"
              onClick={() => set("questions", [...qs, { _key: newKey(), text: "", options: ["", ""], active: true }])}
              className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar pergunta
            </button>
          )}

          <div>
            <label className={labelCls}>Mensagem depois do envio</label>
            <textarea className={`${inputCls} resize-y`} rows={2} maxLength={L.thankYou} placeholder={BIO_DEFAULT_THANK_YOU} value={draft.thankYouMessage ?? ""} onChange={(e) => set("thankYouMessage", e.target.value || null)} />
          </div>
          <div>
            <label className={labelCls}>Texto de consentimento (LGPD)</label>
            <textarea className={`${inputCls} resize-y`} rows={3} maxLength={L.consent} placeholder={defaultConsent} value={draft.consentText ?? ""} onChange={(e) => set("consentText", e.target.value || null)} />
            <p className="text-slate-600 text-[11px] mt-1">Em branco, usamos o texto padrão acima.</p>
          </div>
        </>
      )}
    </>
  );
}

// ─── Passo 4: publicar ───────────────────────────────────────────────────────

/** Normaliza enquanto digita: igual ao slugifyBio, mas deixa o hífen do fim (a pessoa ainda vai digitar). */
function typingSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

function StepPublish({
  draft, saved, set, publicBase, publicUrl, saving, copied, onCopy, onPublish,
}: {
  draft: Draft;
  saved: Draft;
  set: Setter;
  publicBase: string;
  publicUrl: string;
  saving: boolean;
  copied: boolean;
  onCopy: () => void;
  onPublish: (published: boolean) => void;
}) {
  const [check, setCheck] = useState<{ slug: string; available: boolean; problem: string | null } | null>(null);

  // Confere o endereço enquanto digita (a palavra final é do salvar).
  useEffect(() => {
    if (draft.slug === saved.slug) return;
    const slug = draft.slug;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/pagina/endereco?slug=${encodeURIComponent(slug)}`).catch(() => null);
      const j = res?.ok ? await res.json() : null;
      if (j) setCheck({ slug, ...j });
    }, 400);
    return () => clearTimeout(t);
  }, [draft.slug, saved.slug]);

  const status = draft.slug === saved.slug ? null : check?.slug === draft.slug ? check : null;
  const problemText: Record<string, string> = {
    curto: "Muito curto.", longo: "Muito longo.", formato: "Use letras minúsculas, números e hífen.",
    reservado: "Endereço reservado.", "em-uso": "Já está em uso.",
  };

  return (
    <>
      <div>
        <label className={labelCls}>Endereço da página</label>
        <div className="flex items-center rounded-lg border border-[#1e2d45] bg-[#161f30] focus-within:border-indigo-500">
          <span className="pl-3 text-xs text-slate-500 whitespace-nowrap">{publicBase.replace(/^https?:\/\//, "")}</span>
          <input
            className="flex-1 min-w-0 bg-transparent px-1 py-2 text-sm text-white focus:outline-none"
            value={draft.slug}
            onChange={(e) => set("slug", typingSlug(e.target.value))}
          />
        </div>
        {status && (
          <p className={`text-xs mt-1 ${status.available ? "text-emerald-400" : "text-red-400"}`}>
            {status.available ? "Disponível." : problemText[status.problem ?? ""] ?? "Indisponível."}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3">
        {saved.published ? (
          <>
            <p className="text-sm text-white font-semibold">Sua página está no ar</p>
            <p className="text-xs text-slate-400 mt-0.5">Coloque este link na bio do Instagram, no WhatsApp e no Google.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <code className="flex-1 min-w-0 truncate rounded-md bg-[#161f30] px-2 py-1.5 text-xs text-emerald-300">{publicUrl}</code>
              <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#161f30] border border-[#1e2d45] text-xs text-slate-200">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copiado" : "Copiar"}
              </button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#161f30] border border-[#1e2d45] text-xs text-slate-200">
                <ExternalLink className="w-3.5 h-3.5" /> Abrir
              </a>
            </div>
            <button type="button" disabled={saving} onClick={() => onPublish(false)} className="mt-3 text-xs text-slate-500 hover:text-red-400">
              Tirar do ar (volta a ser rascunho)
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-white font-semibold">Pronto para publicar?</p>
            <p className="text-xs text-slate-400 mt-0.5">Enquanto for rascunho, só você vê pela prévia. Publicar também salva as alterações.</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => onPublish(true)}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Publicar página
            </button>
          </>
        )}
      </div>
    </>
  );
}

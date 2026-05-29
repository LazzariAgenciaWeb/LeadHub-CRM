"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Template { id: string; name: string; subject: string; }
interface Tag { id: string; name: string; color: string; }
interface Stage { name: string; pipeline: string; }

const CADENCE_PRESETS = [
  { id: "slow",   label: "Lento — 30/h",  maxPerHour: 30 },
  { id: "normal", label: "Normal — 60/h", maxPerHour: 60 },
  { id: "fast",   label: "Rápido — 120/h", maxPerHour: 120 },
];

const PIPELINES = [
  { value: "",              label: "Qualquer pipeline" },
  { value: "PROSPECCAO",    label: "🔎 Prospecção" },
  { value: "LEADS",         label: "🎯 Leads" },
  { value: "OPORTUNIDADES", label: "💡 Oportunidades" },
];

export default function NewCampaignWizard({
  companyId, templates, tags, stages,
}: {
  companyId?: string;
  templates: Template[];
  tags: Tag[];
  stages: Stage[];
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [pipelineStage, setPipelineStage] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState("normal");
  const [scheduled, setScheduled] = useState("");
  const [creating, setCreating] = useState(false);

  // Preview ao vivo do segmento
  const [preview, setPreview] = useState<{ count: number; deliverable: number; suppressed: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const filteredStages = useMemo(
    () => pipeline ? stages.filter((s) => s.pipeline === pipeline) : [],
    [pipeline, stages]
  );

  // Recarrega preview com debounce ao mudar filtros
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch("/api/email/preview-segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segmentFilter: { pipeline: pipeline || null, pipelineStage: pipelineStage || null, tagIds },
            ...(companyId ? { companyId } : {}),
          }),
        });
        if (res.ok && !cancelled) setPreview(await res.json());
      } finally { if (!cancelled) setPreviewLoading(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pipeline, pipelineStage, tagIds, companyId]);

  function toggleTag(id: string) {
    setTagIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function create(start: boolean) {
    if (!name.trim() || !templateId) return;
    setCreating(true);
    const cad = CADENCE_PRESETS.find((c) => c.id === cadence)!;
    const res = await fetch("/api/email/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        templateId,
        subject: subject || undefined,
        scheduledAt: scheduled || null,
        cadenceConfig: { maxPerHour: cad.maxPerHour },
        segmentFilter: { pipeline: pipeline || null, pipelineStage: pipelineStage || null, tagIds },
        ...(companyId ? { companyId } : {}),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Erro ao criar");
      setCreating(false);
      return;
    }
    const created = await res.json();
    if (start) {
      const startRes = await fetch(`/api/email/campaigns/${created.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const d = await startRes.json().catch(() => ({}));
        alert(`Campanha criada mas não disparou: ${d.error ?? "erro"}`);
      }
    }
    router.push(`/campanhas/email/campanhas/${created.id}`);
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">🚀 Nova campanha de e-mail</h1>
          <p className="text-slate-500 text-sm mt-0.5">Defina template, público e cadência. Você pode salvar como rascunho ou disparar já.</p>
        </div>
        <Link href="/campanhas/email" className="text-slate-500 hover:text-white text-xs">← Voltar</Link>
      </div>

      <div className="space-y-6">
        {/* Passo 1: Identificação + Template */}
        <Section step="1" title="Identificação">
          <div className="space-y-3">
            <Field label="Nome interno da campanha *">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder='Ex: "Push de Janeiro — VIPs"' className={INPUT} />
            </Field>
            <Field label="Template *">
              {templates.length === 0 ? (
                <p className="text-amber-400 text-xs">
                  Você ainda não tem nenhum template.{" "}
                  <Link href="/campanhas/email" className="underline">Criar primeiro template →</Link>
                </p>
              ) : (
                <select value={templateId} onChange={(e) => {
                  setTemplateId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t && !subject) setSubject(t.subject);
                }} className={INPUT}>
                  <option value="">Escolha o template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Assunto (override — se vazio usa o do template)">
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Use {{nome}} pra personalizar" className={INPUT} />
            </Field>
          </div>
        </Section>

        {/* Passo 2: Segmento */}
        <Section step="2" title="Quem vai receber?">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pipeline">
                <select value={pipeline} onChange={(e) => { setPipeline(e.target.value); setPipelineStage(""); }} className={INPUT}>
                  {PIPELINES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Etapa">
                <select value={pipelineStage} onChange={(e) => setPipelineStage(e.target.value)} disabled={!pipeline} className={`${INPUT} disabled:opacity-50`}>
                  <option value="">Qualquer etapa</option>
                  {filteredStages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Tags (qualquer uma das selecionadas)">
              {tags.length === 0 ? (
                <p className="text-slate-600 text-xs italic">Você ainda não criou tags.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const active = tagIds.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => toggleTag(t.id)} type="button"
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                        style={active ? {
                          backgroundColor: `${t.color}33`, borderColor: t.color, color: t.color,
                        } : {
                          backgroundColor: "transparent", borderColor: "#1e2d45", color: "#94a3b8",
                        }}>
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            {/* Live preview */}
            <div className="bg-[#0a0f1a] border border-indigo-500/20 rounded-lg p-3">
              {previewLoading ? (
                <p className="text-slate-500 text-xs">Calculando…</p>
              ) : preview ? (
                <div className="text-sm">
                  <span className="text-white font-bold">{preview.deliverable}</span>
                  <span className="text-slate-400"> leads vão receber</span>
                  {preview.suppressed > 0 && (
                    <span className="text-orange-400 text-xs ml-2">({preview.suppressed} descadastrados serão pulados)</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </Section>

        {/* Passo 3: Cadência + Agendamento */}
        <Section step="3" title="Como vai disparar?">
          <div className="space-y-3">
            <Field label="Cadência">
              <div className="grid grid-cols-3 gap-2">
                {CADENCE_PRESETS.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCadence(c.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      cadence === c.id ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200" : "bg-[#0a0f1a] border-[#1e2d45] text-slate-400 hover:text-white"
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="text-slate-600 text-[10px] mt-1.5">Padrão: seg-sex, 9h-18h (TZ Brasília). Edite depois nos detalhes da campanha.</p>
            </Field>
            <Field label="Agendar pra (opcional — vazio = começa imediatamente após criar)">
              <input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} className={INPUT} />
            </Field>
          </div>
        </Section>

        <div className="flex gap-2 pt-2">
          <button onClick={() => create(false)} disabled={creating || !name.trim() || !templateId} className="flex-1 py-3 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm font-medium disabled:opacity-40">
            {creating ? "Salvando..." : "Salvar como rascunho"}
          </button>
          <button onClick={() => create(true)} disabled={creating || !name.trim() || !templateId || (preview?.deliverable ?? 0) === 0} className="flex-1 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
            {creating ? "Criando..." : `Criar e disparar ${preview ? `(${preview.deliverable})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const INPUT = "w-full bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">{step}</span>
        <h2 className="text-white font-bold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-slate-400 text-xs font-medium mb-1">{label}</label>
      {children}
    </div>
  );
}

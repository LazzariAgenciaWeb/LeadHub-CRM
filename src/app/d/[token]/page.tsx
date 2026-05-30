import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

// Página pública (sem auth) do diagnóstico do prospect.
// 1º clique: registra diagnosisClickedAt + auto-promove pra LEADS.
// Renderiza diagnóstico bonito + botão WhatsApp da empresa-cliente (não dispara,
// é o LEAD que clica e inicia a conversa — evita disparo indevido).

export const dynamic = "force-dynamic";

type DiagPoint = { title: string; detail: string };
type Diagnosis = {
  summary: string;
  positives: DiagPoint[];
  opportunities: DiagPoint[];
  criticals: DiagPoint[];
};

function isDiagnosis(d: unknown): d is Diagnosis {
  if (!d || typeof d !== "object") return false;
  const dd = d as any;
  return typeof dd.summary === "string"
    && Array.isArray(dd.positives)
    && Array.isArray(dd.opportunities)
    && Array.isArray(dd.criticals);
}

export default async function DiagnosticoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const lead = await prisma.lead.findUnique({
    where: { diagnosisToken: token },
    include: {
      company: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!lead || !lead.diagnosis) notFound();

  // 1º clique: registra timestamp + promove pra LEADS automaticamente.
  // Faz em paralelo (não bloqueia o render) — mas espera concluir pra
  // garantir consistência caso o user feche a aba imediatamente.
  if (!lead.diagnosisClickedAt) {
    // Etapa inicial do pipeline LEADS pra empresa do lead
    const firstLeadStage = await prisma.pipelineStageConfig.findFirst({
      where: { companyId: lead.companyId, pipeline: "LEADS" },
      orderBy: { order: "asc" },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        diagnosisClickedAt: new Date(),
        // Só promove se ainda está em PROSPECCAO (não mexe se já saiu)
        ...(lead.pipeline === "PROSPECCAO"
          ? {
              pipeline: "LEADS",
              pipelineStage: firstLeadStage?.name ?? null,
            }
          : {}),
      },
    });
  }

  const diagnosis = isDiagnosis(lead.diagnosis) ? lead.diagnosis : null;
  if (!diagnosis) notFound();

  // WhatsApp da empresa-cliente: prioriza instância CONNECTED, fallback Company.phone
  const instance = await prisma.whatsappInstance.findFirst({
    where: { companyId: lead.companyId, status: "CONNECTED" },
    select: { phone: true },
  });
  const waNumberRaw = instance?.phone ?? lead.company?.phone ?? null;
  const waNumber = waNumberRaw ? waNumberRaw.replace(/\D/g, "") : null;
  const waMessage = encodeURIComponent(
    `Olá! Acabei de ver o diagnóstico que vocês prepararam para ${lead.name ?? "minha empresa"} e gostaria de saber mais.`
  );
  const waLink = waNumber ? `https://wa.me/${waNumber}?text=${waMessage}` : null;

  const isLimited = lead.diagnosisSource === "instagram" || lead.diagnosisSource === "none";

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0a0f1a] via-[#0b1220] to-[#0a0f1a] text-white">
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-16">
        {/* Header */}
        <div className="mb-8">
          <div className="text-xs text-indigo-400 font-semibold uppercase tracking-widest mb-2">
            Diagnóstico digital · cortesia de {lead.company?.name ?? "nossa equipe"}
          </div>
          <h1 className="text-2xl md:text-4xl font-bold text-white">
            {lead.name ?? "Sua empresa"}
          </h1>
          {(lead.city || lead.segment) && (
            <p className="text-slate-400 mt-1 text-sm">
              {[lead.segment, lead.city].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-2xl p-5 mb-6">
          <p className="text-slate-200 leading-relaxed">{diagnosis.summary}</p>
          {isLimited && (
            <p className="text-amber-300 text-xs mt-3 bg-amber-950/30 border border-amber-900/50 rounded px-2 py-1.5 inline-block">
              ⚠️ Análise limitada — feita {lead.diagnosisSource === "instagram" ? "apenas com o perfil do Instagram (sem site)" : "sem site/Instagram disponíveis"}.
            </p>
          )}
        </div>

        {/* Positives */}
        {diagnosis.positives.length > 0 && (
          <Section title="O que está bem feito" icon="✅" tint="emerald" items={diagnosis.positives} />
        )}

        {/* Opportunities */}
        {diagnosis.opportunities.length > 0 && (
          <Section title="Oportunidades de melhoria" icon="⚠️" tint="amber" items={diagnosis.opportunities} />
        )}

        {/* Criticals */}
        {diagnosis.criticals.length > 0 && (
          <Section title="Quick wins recomendados" icon="🔴" tint="rose" items={diagnosis.criticals} />
        )}

        {/* CTA WhatsApp */}
        <div className="mt-10 bg-gradient-to-br from-emerald-950/40 to-emerald-900/20 border border-emerald-700/40 rounded-2xl p-6 md:p-8 text-center">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
            Quer conversar sobre esses pontos?
          </h2>
          <p className="text-slate-300 text-sm md:text-base mb-5 max-w-xl mx-auto">
            Podemos agendar uma call de avaliação sem custo pra discutir esses pontos com mais profundidade — mesmo que você já trabalhe com outra agência, vale como segunda opinião.
          </p>
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-base transition-colors"
            >
              💬 Falar no WhatsApp
            </a>
          ) : (
            <p className="text-slate-500 text-sm italic">
              Entre em contato com {lead.company?.name ?? "nossa equipe"} pra agendar.
            </p>
          )}
        </div>

        <footer className="text-center text-slate-600 text-xs mt-10">
          Diagnóstico gerado em {lead.diagnosisAt ? new Date(lead.diagnosisAt).toLocaleDateString("pt-BR") : "—"}
          {" · "}
          <span className="text-slate-700">cortesia de {lead.company?.name ?? "LeadHub"}</span>
        </footer>
      </div>
    </main>
  );
}

function Section({
  title,
  icon,
  tint,
  items,
}: {
  title: string;
  icon: string;
  tint: "emerald" | "amber" | "rose";
  items: DiagPoint[];
}) {
  const colors = {
    emerald: { border: "border-emerald-700/40", bg: "bg-emerald-950/20", title: "text-emerald-300" },
    amber:   { border: "border-amber-700/40",   bg: "bg-amber-950/20",   title: "text-amber-300"   },
    rose:    { border: "border-rose-700/40",    bg: "bg-rose-950/20",    title: "text-rose-300"    },
  }[tint];

  return (
    <section className={`mb-4 ${colors.bg} ${colors.border} border rounded-2xl p-5`}>
      <h2 className={`text-sm font-bold uppercase tracking-wider ${colors.title} mb-3 flex items-center gap-2`}>
        <span>{icon}</span> {title}
      </h2>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="text-slate-200 text-sm leading-relaxed">
            <strong className="text-white">{item.title}</strong>
            {item.detail && <div className="text-slate-400 mt-0.5">{item.detail}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

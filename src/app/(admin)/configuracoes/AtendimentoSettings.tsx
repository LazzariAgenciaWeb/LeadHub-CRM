"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  companyId: string;
  slaMinutes: number;
  outOfHoursMessage: string;
  businessHours: { start: string; end: string } | null;
}

const PRESETS = [5, 10, 15, 30, 60, 120];

export default function AtendimentoSettings({
  companyId,
  slaMinutes: initialSla,
  outOfHoursMessage: initialOoH,
  businessHours: initialBh,
}: Props) {
  const router = useRouter();
  const [sla, setSla] = useState(initialSla);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState(initialOoH);
  const [bhEnabled, setBhEnabled] = useState(!!initialBh);
  const [bhStart, setBhStart] = useState(initialBh?.start ?? "09:00");
  const [bhEnd, setBhEnd] = useState(initialBh?.end ?? "18:00");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setSaving(true);
    const items: { key: string; value: string }[] = [
      { key: `sla_minutes:${companyId}`,          value: String(sla) },
      { key: `out_of_hours_message:${companyId}`, value: outOfHoursMessage },
      { key: `business_hours:${companyId}`,       value: bhEnabled ? `${bhStart}-${bhEnd}` : "" },
    ];

    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    setSaving(false);
    setSavedAt(Date.now());
    router.refresh();
    setTimeout(() => setSavedAt(null), 2500);
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-white font-bold text-lg mb-1">Atendimento</h2>
        <p className="text-slate-500 text-sm">
          Regras de inbox e SLA para esta empresa. Conversas que ultrapassam o SLA viram <span className="text-red-400 font-medium">Sem atendimento</span>.
        </p>
      </div>

      {/* SLA */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white text-sm font-semibold">⏱️ Tempo limite de atendimento</h3>
            <p className="text-slate-500 text-xs mt-0.5">Quantos minutos uma conversa pode ficar Aberta antes de virar urgente</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={1440}
            value={sla}
            onChange={(e) => setSla(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-24 bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <span className="text-slate-400 text-sm">minutos</span>
          <div className="flex gap-1.5 ml-3">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setSla(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  sla === p
                    ? "bg-indigo-600 text-white"
                    : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"
                }`}
              >
                {p}min
              </button>
            ))}
          </div>
        </div>

        <p className="text-slate-600 text-[11px] mt-3">
          O job de SLA roda de minuto em minuto. Para ativar em produção, configure cron externo apontando para <code className="text-indigo-300 bg-[#080b12] px-1.5 py-0.5 rounded">/api/cron/sla</code>.
        </p>
      </div>

      {/* Horário comercial */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white text-sm font-semibold">🕐 Horário comercial</h3>
            <p className="text-slate-500 text-xs mt-0.5">Quando estamos disponíveis para atender</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={bhEnabled}
              onChange={(e) => setBhEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-500"
            />
            <span className="text-slate-400 text-xs">Ativar</span>
          </label>
        </div>

        {bhEnabled && (
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={bhStart}
              onChange={(e) => setBhStart(e.target.value)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <span className="text-slate-500 text-sm">até</span>
            <input
              type="time"
              value={bhEnd}
              onChange={(e) => setBhEnd(e.target.value)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}
      </div>

      {/* Mensagem fora de horário */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5">
        <div className="mb-3">
          <h3 className="text-white text-sm font-semibold">💬 Mensagem automática fora do horário</h3>
          <p className="text-slate-500 text-xs mt-0.5">Resposta enviada quando o cliente escreve fora do horário comercial (configuração apenas — envio automático será ativado em sprint futuro)</p>
        </div>
        <textarea
          value={outOfHoursMessage}
          onChange={(e) => setOutOfHoursMessage(e.target.value)}
          rows={3}
          placeholder="Ex: Olá! Nosso horário de atendimento é de seg a sex, das 9h às 18h. Retornaremos seu contato no próximo horário comercial."
          className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
      </div>

      {/* Salvar */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
        {savedAt && (
          <span className="text-emerald-400 text-xs">✓ Salvo</span>
        )}
      </div>
    </div>
  );
}

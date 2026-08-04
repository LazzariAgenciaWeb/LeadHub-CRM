"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users, ChevronLeft, ChevronRight, Printer, CircleCheck, CalendarOff,
  ClipboardList, CalendarClock, Trash2, ArrowLeft,
} from "lucide-react";
import {
  TIMEOFF_LABEL, formatMin, monthLabel,
  type PunchTypeStr, type TimeOffTypeStr,
} from "@/lib/ponto-shared";

type Member = {
  id: string;
  name: string;
  email: string;
  totals: { workedMin: number; expectedMin: number; balanceMin: number; faltas: number; abonos: number; diasTrabalhados: number };
  signedAt: string | null;
  hasSchedule: boolean;
};

type Adjustment = {
  id: string;
  userName: string;
  dayKey: string;
  punches: { type: string; time: string }[];
  reason: string;
  status: string;
  reviewNote: string | null;
  reviewedByName: string | null;
};

type TimeOff = {
  id: string;
  userName: string | null;
  type: TimeOffTypeStr;
  startKey: string;
  endKey: string;
  description: string | null;
};

type ScheduleDay = {
  dayOfWeek: number;
  active: boolean;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

const WEEKDAY_FULL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function fmtDay(key: string) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

type Tab = "relatorio" | "ajustes" | "abonos" | "horarios";

export default function EquipeClient({
  year, month, todayKey, members, adjustments, timeOffs,
}: {
  year: number;
  month: number;
  todayKey: string;
  members: Member[];
  adjustments: Adjustment[];
  timeOffs: TimeOff[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("relatorio");
  const [scheduleUser, setScheduleUser] = useState<string>(members[0]?.id ?? "");

  const ymStr = `${year}-${String(month).padStart(2, "0")}`;
  const prevYm = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const nextYm = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const canGoNext = ymStr < todayKey.slice(0, 7);

  const pending = adjustments.filter((a) => a.status === "PENDENTE");

  const tabs: { key: Tab; label: string; Icon: typeof Users; badge?: number }[] = [
    { key: "relatorio", label: "Relatório", Icon: ClipboardList },
    { key: "ajustes",   label: "Ajustes",   Icon: CircleCheck, badge: pending.length },
    { key: "abonos",    label: "Abonos",    Icon: CalendarOff },
    { key: "horarios",  label: "Horários",  Icon: CalendarClock },
  ];

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" /> Ponto da equipe
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Espelhos, ajustes, abonos e jornadas dos colaboradores.
          </p>
        </div>
        <Link
          href="/ponto"
          className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/50 rounded-lg px-3 py-2 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Meu ponto
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-1 w-fit">
        {tabs.map(({ key, label, Icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2 transition-colors ${
              tab === key ? "bg-[#1e2d45] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
            {!!badge && (
              <span className="bg-amber-500/20 text-amber-400 rounded-full px-1.5 text-[10px] font-bold">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "relatorio" && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl">
          <div className="p-4 flex items-center gap-2 border-b border-[#1e2d45]">
            <Link href={`/ponto/equipe?ym=${prevYm}`} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2d45]">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <div className="text-white font-semibold text-sm min-w-[150px] text-center">
              {monthLabel(year, month)}
            </div>
            {canGoNext ? (
              <Link href={`/ponto/equipe?ym=${nextYm}`} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2d45]">
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="w-7 h-7 flex items-center justify-center text-slate-700"><ChevronRight className="w-4 h-4" /></span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-[#1e2d45]">
                  <th className="text-left font-medium px-4 py-2.5">Colaborador</th>
                  <th className="text-right font-medium px-3 py-2.5">Dias</th>
                  <th className="text-right font-medium px-3 py-2.5">Horas</th>
                  <th className="text-right font-medium px-3 py-2.5">Esperado</th>
                  <th className="text-right font-medium px-3 py-2.5">Saldo</th>
                  <th className="text-right font-medium px-3 py-2.5">Faltas</th>
                  <th className="text-right font-medium px-3 py-2.5">Abonos</th>
                  <th className="text-left font-medium px-3 py-2.5">Assinatura</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141c2e]">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200 font-medium">{m.name}</div>
                      {!m.hasSchedule && (
                        <div className="text-amber-500/80 text-[10px]">sem jornada cadastrada</div>
                      )}
                    </td>
                    <td className="text-right px-3 py-2.5 text-slate-300">{m.totals.diasTrabalhados}</td>
                    <td className="text-right px-3 py-2.5 text-slate-200 font-medium">{formatMin(m.totals.workedMin)}</td>
                    <td className="text-right px-3 py-2.5 text-slate-400">{formatMin(m.totals.expectedMin)}</td>
                    <td className={`text-right px-3 py-2.5 font-medium ${m.totals.balanceMin >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatMin(m.totals.balanceMin)}
                    </td>
                    <td className={`text-right px-3 py-2.5 ${m.totals.faltas > 0 ? "text-red-400 font-medium" : "text-slate-500"}`}>
                      {m.totals.faltas}
                    </td>
                    <td className="text-right px-3 py-2.5 text-slate-400">{m.totals.abonos}</td>
                    <td className="px-3 py-2.5">
                      {m.signedAt ? (
                        <span className="flex items-center gap-1 text-green-400">
                          <CircleCheck className="w-3.5 h-3.5" />
                          {new Date(m.signedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <a
                        href={`/espelho-ponto/${m.id}?ym=${ymStr}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                        title="Abrir espelho pra imprimir/salvar PDF"
                      >
                        <Printer className="w-3.5 h-3.5" /> Espelho
                      </a>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-slate-600 py-8">Nenhum colaborador na empresa.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-[10px] text-slate-600 border-t border-[#1e2d45]">
            Controle de jornada interno — o espelho de cada colaborador sai com a assinatura eletrônica (ou campo pra assinatura física) pra enviar à contabilidade.
          </div>
        </div>
      )}

      {tab === "ajustes" && <AjustesTab adjustments={adjustments} onDone={() => router.refresh()} />}

      {tab === "abonos" && (
        <AbonosTab
          ymStr={ymStr}
          members={members}
          timeOffs={timeOffs}
          onDone={() => router.refresh()}
        />
      )}

      {tab === "horarios" && (
        <HorariosTab
          members={members}
          scheduleUser={scheduleUser}
          setScheduleUser={setScheduleUser}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ─── Ajustes ─────────────────────────────────────────────────────────────────

function AjustesTab({ adjustments, onDone }: { adjustments: Adjustment[]; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const pending = adjustments.filter((a) => a.status === "PENDENTE");
  const reviewed = adjustments.filter((a) => a.status !== "PENDENTE");

  async function review(id: string, action: "approve" | "reject") {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/ponto/adjustments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: notes[id] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Erro ao revisar");
      else onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="text-white font-semibold text-sm mb-3">Pendentes ({pending.length})</div>
        {pending.length === 0 && <div className="text-slate-600 text-xs">Nenhuma solicitação pendente. 🎉</div>}
        <div className="space-y-3">
          {pending.map((a) => (
            <div key={a.id} className="bg-white/[0.02] border border-[#1e2d45] rounded-lg p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-xs">
                  <span className="text-slate-200 font-medium">{a.userName}</span>
                  <span className="text-slate-500"> — dia {fmtDay(a.dayKey)}</span>
                </div>
                <div className="text-xs text-slate-300">
                  {a.punches.map((p) => p.time).join(" · ")}
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-1.5">Motivo: {a.reason}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <input
                  value={notes[a.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                  placeholder="Observação (opcional)"
                  className="flex-1 min-w-[160px] bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600"
                />
                <button
                  onClick={() => review(a.id, "approve")}
                  disabled={busy === a.id}
                  className="text-xs font-semibold bg-green-500/15 text-green-400 hover:bg-green-500/25 rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => review(a.id, "reject")}
                  disabled={busy === a.id}
                  className="text-xs font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                  Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {reviewed.length > 0 && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="text-white font-semibold text-sm mb-3">Histórico</div>
          <div className="space-y-1.5">
            {reviewed.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`rounded-md px-2 py-0.5 font-medium ${a.status === "APROVADO" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                  {a.status === "APROVADO" ? "Aprovado" : "Rejeitado"}
                </span>
                <span className="text-slate-300">{a.userName}</span>
                <span>dia {fmtDay(a.dayKey)}</span>
                {a.reviewedByName && <span className="text-slate-600">por {a.reviewedByName}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Abonos ──────────────────────────────────────────────────────────────────

function AbonosTab({
  ymStr, members, timeOffs, onDone,
}: {
  ymStr: string;
  members: Member[];
  timeOffs: TimeOff[];
  onDone: () => void;
}) {
  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<TimeOffTypeStr>("FERIADO");
  const [start, setStart] = useState(`${ymStr}-01`);
  const [end, setEnd] = useState(`${ymStr}-01`);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ponto/timeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId || null, type, start, end, description }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Erro ao salvar");
      else {
        setDescription("");
        onDone();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/ponto/timeoff?id=${id}`, { method: "DELETE" });
    if (res.ok) onDone();
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="text-white font-semibold text-sm mb-1">Novo abono</div>
        <p className="text-slate-500 text-xs mb-3">
          Atestado, férias, feriado ou folga — os dias abonados não contam como falta nem somam horas esperadas.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-xs text-slate-400">
            <span className="block mb-1">Colaborador</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200 min-w-[170px]">
              <option value="">Empresa toda (feriado)</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            <span className="block mb-1">Tipo</span>
            <select value={type} onChange={(e) => setType(e.target.value as TimeOffTypeStr)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200">
              {(Object.keys(TIMEOFF_LABEL) as TimeOffTypeStr[]).map((t) => (
                <option key={t} value={t}>{TIMEOFF_LABEL[t]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            <span className="block mb-1">De</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200" />
          </label>
          <label className="text-xs text-slate-400">
            <span className="block mb-1">Até</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200" />
          </label>
          <label className="text-xs text-slate-400 flex-1 min-w-[160px]">
            <span className="block mb-1">Descrição (opcional)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex: Carnaval"
              className="w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600" />
          </label>
          <button
            onClick={submit}
            disabled={saving || start > end}
            className="text-xs font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Adicionar"}
          </button>
        </div>
        {error && <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
      </div>

      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <div className="text-white font-semibold text-sm mb-3">Abonos no mês</div>
        {timeOffs.length === 0 && <div className="text-slate-600 text-xs">Nenhum abono neste mês.</div>}
        <div className="space-y-1.5">
          {timeOffs.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs bg-white/[0.02] rounded-lg px-3 py-2">
              <span className="bg-sky-500/10 text-sky-400 rounded-md px-2 py-0.5 font-medium">{TIMEOFF_LABEL[t.type]}</span>
              <span className="text-slate-200 font-medium">{t.userName ?? "Empresa toda"}</span>
              <span className="text-slate-400">
                {fmtDay(t.startKey)}{t.startKey !== t.endKey && ` – ${fmtDay(t.endKey)}`}
              </span>
              {t.description && <span className="text-slate-500">· {t.description}</span>}
              <button onClick={() => remove(t.id)} className="ml-auto text-slate-600 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Horários (jornada semanal) ──────────────────────────────────────────────

function HorariosTab({
  members, scheduleUser, setScheduleUser, onSaved,
}: {
  members: Member[];
  scheduleUser: string;
  setScheduleUser: (id: string) => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [hasCustom, setHasCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!scheduleUser) return;
    let cancelled = false;
    setLoading(true);
    setMsg(null);
    fetch(`/api/ponto/schedules?userId=${scheduleUser}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDays(data.days ?? null);
        setHasCustom(!!data.hasCustom);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scheduleUser]);

  function update(dow: number, patch: Partial<ScheduleDay>) {
    setDays((d) => d?.map((x) => (x.dayOfWeek === dow ? { ...x, ...patch } : x)) ?? null);
  }

  async function save() {
    if (!days || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ponto/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: scheduleUser, days }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ text: data.error ?? "Erro ao salvar", ok: false });
      else {
        setMsg({ text: "Jornada salva ✔", ok: true });
        setHasCustom(true);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="text-white font-semibold text-sm">Jornada semanal</div>
        <select
          value={scheduleUser}
          onChange={(e) => setScheduleUser(e.target.value)}
          className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200 min-w-[170px]"
        >
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Horário esperado de cada dia — usado pra calcular horas esperadas, atrasos e faltas.
        {!hasCustom && !loading && (
          <span className="text-amber-500/80"> Este colaborador ainda usa o padrão (seg–sex 09–18, almoço 12–13) — salve pra oficializar.</span>
        )}
      </p>

      {loading && <div className="text-slate-500 text-xs py-6 text-center">Carregando…</div>}

      {!loading && days && (
        <div className="space-y-1.5">
          {days.map((d) => (
            <div key={d.dayOfWeek} className={`flex items-center gap-2 flex-wrap rounded-lg px-3 py-2 ${d.active ? "bg-white/[0.02]" : "opacity-50"}`}>
              <label className="flex items-center gap-2 w-24 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={d.active}
                  onChange={(e) => update(d.dayOfWeek, { active: e.target.checked })}
                  className="accent-indigo-500"
                />
                {WEEKDAY_FULL[d.dayOfWeek]}
              </label>
              <input type="time" value={d.startTime} disabled={!d.active}
                onChange={(e) => update(d.dayOfWeek, { startTime: e.target.value })}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-slate-200" />
              <span className="text-slate-600 text-xs">às</span>
              <input type="time" value={d.endTime} disabled={!d.active}
                onChange={(e) => update(d.dayOfWeek, { endTime: e.target.value })}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-slate-200" />
              <span className="text-slate-600 text-xs ml-2">intervalo</span>
              <input type="time" value={d.breakStart ?? ""} disabled={!d.active}
                onChange={(e) => update(d.dayOfWeek, { breakStart: e.target.value || null })}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-slate-200" />
              <span className="text-slate-600 text-xs">–</span>
              <input type="time" value={d.breakEnd ?? ""} disabled={!d.active}
                onChange={(e) => update(d.dayOfWeek, { breakEnd: e.target.value || null })}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1 text-xs text-slate-200" />
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${msg.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving || loading || !days}
          className="text-xs font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar jornada"}
        </button>
      </div>
    </div>
  );
}

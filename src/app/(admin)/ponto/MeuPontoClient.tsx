"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock, LogIn, LogOut, Coffee, ChevronLeft, ChevronRight, Users,
  Printer, PenLine, CircleCheck, CircleAlert, X, Plus, Trash2,
} from "lucide-react";
import {
  PUNCH_LABEL, TIMEOFF_LABEL, WEEKDAY_SHORT, STATUS_LABEL, formatMin, monthLabel,
  type Espelho, type EspelhoDay, type PunchTypeStr,
} from "@/lib/ponto-shared";

type TodayState = {
  punches: { id: string; type: PunchTypeStr; time: string; source: string }[];
  allowedNext: PunchTypeStr[];
  workedMin: number;
  clockOpen: boolean;
  schedule: { startTime: string; endTime: string } | null;
};

type MyRequest = {
  id: string;
  dayKey: string;
  reason: string;
  status: string;
  reviewNote: string | null;
  punches: { type: string; time: string }[];
};

const PUNCH_ICON: Record<PunchTypeStr, typeof LogIn> = {
  ENTRADA: LogIn,
  INTERVALO_INICIO: Coffee,
  INTERVALO_FIM: Coffee,
  SAIDA: LogOut,
};

const STATUS_CHIP: Record<EspelhoDay["status"], string> = {
  OK:          "bg-green-500/10 text-green-400",
  HOJE:        "bg-indigo-500/10 text-indigo-400",
  INCOMPLETO:  "bg-amber-500/10 text-amber-400",
  FALTA:       "bg-red-500/10 text-red-400",
  ABONO:       "bg-sky-500/10 text-sky-400",
  SEM_JORNADA: "bg-white/5 text-slate-500",
  FUTURO:      "bg-transparent text-slate-600",
};

function fmtDay(key: string) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

export default function MeuPontoClient({
  espelho, signature, myRequests, todayKey, userId, isAdmin,
}: {
  espelho: Espelho;
  signature: { signedAt: string; ip: string | null } | null;
  myRequests: MyRequest[];
  todayKey: string;
  userId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [today, setToday] = useState<TodayState | null>(null);
  const [punching, setPunching] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [signing, setSigning] = useState(false);
  const [adjustDay, setAdjustDay] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    try {
      const res = await fetch("/api/ponto/today");
      if (res.ok) setToday(await res.json());
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  // Relógio da tela
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function punch(type: PunchTypeStr) {
    if (punching) return;
    setPunching(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ponto/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ text: data.error ?? "Erro ao bater o ponto", ok: false });
      } else {
        setMsg({ text: `${PUNCH_LABEL[type]} registrada às ${data.punch.time}`, ok: true });
        await loadToday();
        router.refresh();
      }
    } catch {
      setMsg({ text: "Falha de conexão — tente de novo", ok: false });
    } finally {
      setPunching(false);
    }
  }

  async function sign() {
    if (signing) return;
    setSigning(true);
    setMsg(null);
    try {
      const ym = `${espelho.year}-${String(espelho.month).padStart(2, "0")}`;
      const res = await fetch("/api/ponto/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ text: data.error ?? "Erro ao assinar", ok: false });
      else {
        setMsg({ text: "Espelho assinado eletronicamente ✔", ok: true });
        router.refresh();
      }
    } finally {
      setSigning(false);
    }
  }

  const ymStr = `${espelho.year}-${String(espelho.month).padStart(2, "0")}`;
  const prevYm = espelho.month === 1 ? `${espelho.year - 1}-12` : `${espelho.year}-${String(espelho.month - 1).padStart(2, "0")}`;
  const nextYm = espelho.month === 12 ? `${espelho.year + 1}-01` : `${espelho.year}-${String(espelho.month + 1).padStart(2, "0")}`;
  const isCurrentMonth = ymStr === todayKey.slice(0, 7);
  const canGoNext = ymStr < todayKey.slice(0, 7);

  const pendingCount = myRequests.filter((r) => r.status === "PENDENTE").length;

  const pastDays = useMemo(
    () => espelho.days.filter((d) => d.key <= todayKey),
    [espelho.days, todayKey],
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" /> Meu ponto
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Controle de jornada interno — não substitui registro de ponto oficial (REP).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/ponto/equipe"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/50 rounded-lg px-3 py-2 transition-colors"
            >
              <Users className="w-3.5 h-3.5" /> Equipe
            </Link>
          )}
          <a
            href={`/espelho-ponto/${userId}?ym=${ymStr}`}
            target="_blank"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-[#0f1623] border border-[#1e2d45] hover:border-indigo-500/50 rounded-lg px-3 py-2 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" /> Espelho / PDF
          </a>
        </div>
      </div>

      {/* Card de bater ponto */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-3xl font-bold text-white tabular-nums">
              {now
                ? now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "--:--:--"}
            </div>
            <div className="text-slate-500 text-xs mt-1">
              {now?.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
              {today?.schedule && (
                <span className="ml-2 text-slate-400">
                  · jornada {today.schedule.startTime}–{today.schedule.endTime}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {(today?.allowedNext ?? []).map((t) => {
              const Icon = PUNCH_ICON[t];
              const primary = t === "ENTRADA" || t === "SAIDA";
              return (
                <button
                  key={t}
                  onClick={() => punch(t)}
                  disabled={punching}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    primary
                      ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:opacity-90"
                      : "bg-[#1e2d45] text-slate-200 hover:bg-[#27395a]"
                  }`}
                >
                  <Icon className="w-4 h-4" /> {PUNCH_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Batidas de hoje */}
        <div className="mt-4 pt-4 border-t border-[#1e2d45] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {(today?.punches ?? []).length === 0 && (
              <span className="text-slate-600 text-xs">Nenhuma marcação hoje ainda.</span>
            )}
            {(today?.punches ?? []).map((p) => (
              <span key={p.id} className="text-xs bg-white/5 text-slate-300 rounded-md px-2 py-1">
                {PUNCH_LABEL[p.type]} <b className="text-white">{p.time}</b>
                {p.source === "AJUSTE" && <span className="text-amber-400 ml-1" title="Criada via ajuste aprovado">*</span>}
              </span>
            ))}
          </div>
          {today && (
            <div className="text-xs text-slate-400">
              Trabalhado hoje: <b className="text-white">{formatMin(today.workedMin)}</b>
              {today.clockOpen && <span className="text-green-400 ml-1.5">● em andamento</span>}
            </div>
          )}
        </div>

        {msg && (
          <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${msg.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Espelho do mês */}
      <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl">
        <div className="p-5 flex items-center justify-between flex-wrap gap-3 border-b border-[#1e2d45]">
          <div className="flex items-center gap-2">
            <Link href={`/ponto?ym=${prevYm}`} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2d45]">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <div className="text-white font-semibold text-sm min-w-[150px] text-center">
              {monthLabel(espelho.year, espelho.month)}
            </div>
            {canGoNext ? (
              <Link href={`/ponto?ym=${nextYm}`} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2d45]">
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span className="w-7 h-7 flex items-center justify-center text-slate-700"><ChevronRight className="w-4 h-4" /></span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div><span className="text-slate-500">Trabalhado </span><b className="text-white">{formatMin(espelho.totals.workedMin)}</b></div>
            <div><span className="text-slate-500">Esperado </span><b className="text-white">{formatMin(espelho.totals.expectedMin)}</b></div>
            <div>
              <span className="text-slate-500">Saldo </span>
              <b className={espelho.totals.balanceMin >= 0 ? "text-green-400" : "text-red-400"}>
                {formatMin(espelho.totals.balanceMin)}
              </b>
            </div>
            {espelho.totals.faltas > 0 && (
              <div><span className="text-slate-500">Faltas </span><b className="text-red-400">{espelho.totals.faltas}</b></div>
            )}
          </div>
        </div>

        {/* Assinatura */}
        <div className="px-5 py-3 border-b border-[#1e2d45] flex items-center justify-between flex-wrap gap-2">
          {signature ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CircleCheck className="w-4 h-4" />
              Espelho assinado eletronicamente em {new Date(signature.signedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <PenLine className="w-4 h-4 text-slate-500" />
                {isCurrentMonth
                  ? "No fechamento do mês, confira as marcações e assine o espelho."
                  : "Confira as marcações e assine o espelho pra fechar o mês."}
              </div>
              <button
                onClick={sign}
                disabled={signing || pendingCount > 0}
                title={pendingCount > 0 ? "Você tem ajuste pendente de revisão" : undefined}
                className="text-xs font-semibold bg-[#1e2d45] hover:bg-[#27395a] text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {signing ? "Assinando…" : "Confirmo que as marcações estão corretas"}
              </button>
            </>
          )}
        </div>

        {/* Dias */}
        <div className="divide-y divide-[#141c2e]">
          {pastDays.slice().reverse().map((d) => (
            <div key={d.key} className="px-5 py-2.5 flex items-center gap-3 text-xs">
              <div className="w-14 text-slate-400 font-medium">
                {fmtDay(d.key)} <span className="text-slate-600">{WEEKDAY_SHORT[d.weekday]}</span>
              </div>
              <span className={`rounded-md px-2 py-0.5 font-medium ${STATUS_CHIP[d.status]}`}>
                {d.status === "ABONO" && d.timeOff ? TIMEOFF_LABEL[d.timeOff] : STATUS_LABEL[d.status]}
              </span>
              <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                {d.punches.map((p, i) => (
                  <span key={i} className="text-slate-300 bg-white/5 rounded px-1.5 py-0.5">
                    {p.time}{p.source === "AJUSTE" && <span className="text-amber-400">*</span>}
                  </span>
                ))}
                {d.punches.length === 0 && d.status !== "ABONO" && (
                  <span className="text-slate-700">—</span>
                )}
              </div>
              <div className="w-24 text-right text-slate-400">
                {d.workedMin > 0 && <span className="text-slate-200">{formatMin(d.workedMin)}</span>}
                {d.expectedMin > 0 && <span className="text-slate-600"> / {formatMin(d.expectedMin)}</span>}
              </div>
              {d.key !== todayKey && (
                <button
                  onClick={() => setAdjustDay(d.key)}
                  className="text-slate-500 hover:text-indigo-400 transition-colors"
                  title="Solicitar ajuste deste dia"
                >
                  <CircleAlert className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Minhas solicitações */}
      {myRequests.length > 0 && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
          <div className="text-white font-semibold text-sm mb-3">Minhas solicitações de ajuste</div>
          <div className="space-y-2">
            {myRequests.map((r) => (
              <div key={r.id} className="flex items-start gap-3 text-xs bg-white/[0.02] rounded-lg px-3 py-2">
                <span className="text-slate-300 font-medium w-14 shrink-0">{fmtDay(r.dayKey)}</span>
                <span className={`rounded-md px-2 py-0.5 font-medium shrink-0 ${
                  r.status === "PENDENTE" ? "bg-amber-500/10 text-amber-400"
                  : r.status === "APROVADO" ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
                }`}>
                  {r.status === "PENDENTE" ? "Pendente" : r.status === "APROVADO" ? "Aprovado" : "Rejeitado"}
                </span>
                <div className="flex-1 text-slate-400">
                  <span className="text-slate-300">{r.punches.map((p) => p.time).join(" · ")}</span>
                  <span className="text-slate-500"> — {r.reason}</span>
                  {r.reviewNote && <div className="text-slate-500 mt-0.5">Resposta: {r.reviewNote}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {adjustDay && (
        <AdjustModal
          dayKey={adjustDay}
          initial={espelho.days.find((d) => d.key === adjustDay)?.punches ?? []}
          onClose={() => setAdjustDay(null)}
          onSaved={() => { setAdjustDay(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Modal de solicitação de ajuste ─────────────────────────────────────────

function AdjustModal({
  dayKey, initial, onClose, onSaved,
}: {
  dayKey: string;
  initial: { type: PunchTypeStr; time: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<{ type: PunchTypeStr; time: string }[]>(
    initial.length > 0
      ? initial.map((p) => ({ type: p.type, time: p.time }))
      : [
          { type: "ENTRADA", time: "09:00" },
          { type: "INTERVALO_INICIO", time: "12:00" },
          { type: "INTERVALO_FIM", time: "13:00" },
          { type: "SAIDA", time: "18:00" },
        ],
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ponto/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dayKey, punches: rows, reason }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Erro ao enviar solicitação");
      else onSaved();
    } catch {
      setError("Falha de conexão");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0f1623] border border-[#1e2d45] rounded-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-white font-semibold text-sm">
            Solicitar ajuste — {dayKey.slice(8, 10)}/{dayKey.slice(5, 7)}/{dayKey.slice(0, 4)}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-slate-500 text-xs mb-3">
          Informe <b className="text-slate-300">todas</b> as marcações corretas do dia — ao aprovar,
          elas substituem as existentes.
        </p>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={row.type}
                onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, type: e.target.value as PunchTypeStr } : x)))}
                className="flex-1 bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200"
              >
                {(Object.keys(PUNCH_LABEL) as PunchTypeStr[]).map((t) => (
                  <option key={t} value={t}>{PUNCH_LABEL[t]}</option>
                ))}
              </select>
              <input
                type="time"
                value={row.time}
                onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-2 py-1.5 text-xs text-slate-200"
              />
              <button
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                className="text-slate-600 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRows((r) => [...r, { type: "SAIDA", time: "18:00" }])}
          disabled={rows.length >= 8}
          className="mt-2 flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar marcação
        </button>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (ex: esqueci de bater a saída, sistema fora do ar…)"
          rows={2}
          className="mt-3 w-full bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 resize-none"
        />

        {error && <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-white px-3 py-2">Cancelar</button>
          <button
            onClick={submit}
            disabled={saving || !reason.trim() || rows.length === 0}
            className="text-xs font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {saving ? "Enviando…" : "Enviar solicitação"}
          </button>
        </div>
      </div>
    </div>
  );
}

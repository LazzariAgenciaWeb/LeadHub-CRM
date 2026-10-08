"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Send } from "lucide-react";

/**
 * Aprovação de peças pelo cliente via link + grupo do WhatsApp.
 *   • ApprovalCard     — no projeto: escolhe o grupo, regra de lembrete e
 *                        mostra o que está esperando o cliente.
 *   • TaskApprovalBar  — na tarefa: "Enviar pra aprovação" e a situação da rodada.
 */

export type TaskApproval = {
  token: string;
  round: number;
  sentAt: string | null;
  viewedAt: string | null;
  lastViewAt: string | null;
  viewCount: number;
  slidesSeen: number;
  slidesTotal: number;
  nudgeCount: number;
  approvedAt: string | null;
  approvedBy: string | null;
};

type ApprovalTask = { id: string; title: string; status: string; approval: TaskApproval | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function diasDesde(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** "viu 07/10 15:40 · 3 visitas · 5 de 7 slides" — ou "não abriu". */
function viewSummary(a: TaskApproval): string {
  if (!a.viewedAt) return "não abriu";
  const parts = [`viu ${fmt(a.lastViewAt ?? a.viewedAt)}`];
  if (a.viewCount > 1) parts.push(`${a.viewCount} visitas`);
  if (a.slidesTotal > 1) {
    parts.push(a.slidesSeen >= a.slidesTotal ? `passou os ${a.slidesTotal} slides` : `${a.slidesSeen} de ${a.slidesTotal} slides`);
  }
  return parts.join(" · ");
}

function approvalLink(token: string) {
  return `${window.location.origin}/aprovar/${token}`;
}

function CopyLink({ token }: { token: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(approvalLink(token)).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
      title="Copiar link de aprovação"
    >
      {ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {ok ? "copiado" : "link"}
    </button>
  );
}

export function ApprovalCard({
  project, tasks,
}: {
  project: {
    id: string;
    approvalGroupJid: string | null;
    approvalGroupName: string | null;
    approvalReminderDays: number;
    approvalMaxReminders: number;
  };
  tasks: ApprovalTask[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<{ jid: string; name: string; ofClient: boolean }[] | null>(null);
  const [jid, setJid] = useState(project.approvalGroupJid ?? "");
  const [gName, setGName] = useState(project.approvalGroupName ?? "");
  const [days, setDays] = useState(project.approvalReminderDays);
  const [max, setMax] = useState(project.approvalMaxReminders);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/projetos/${project.id}/aprovacao/grupos?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setGroups(d.groups ?? []))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, editing, project.id]);

  async function save(next?: { jid: string; name: string }) {
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/projetos/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalGroupJid:     next ? next.jid : jid,
        approvalGroupName:    next ? next.name : gName,
        approvalReminderDays: days,
        approvalMaxReminders: max,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErr(d?.error ?? "Não foi possível salvar.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const waiting = tasks.filter((t) => t.status === "AGUARDANDO_CLIENTE" && t.approval?.sentAt);
  const approved = tasks
    .filter((t) => t.status === "APROVADO" && t.approval?.approvedAt)
    .sort((a, b) => (b.approval!.approvedAt! > a.approval!.approvedAt! ? 1 : -1))
    .slice(0, 5);

  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-white font-semibold text-sm">📣 Aprovação pelo WhatsApp</h3>
          <p className="text-slate-500 text-xs mt-0.5">
            {project.approvalGroupJid ? (
              <>Grupo <span className="text-slate-300">{project.approvalGroupName ?? project.approvalGroupJid}</span> · lembra a cada {project.approvalReminderDays} dia{project.approvalReminderDays > 1 ? "s" : ""}, até {project.approvalMaxReminders}x</>
            ) : (
              "Escolha o grupo do cliente que recebe o link de cada peça."
            )}
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white shrink-0">
            {project.approvalGroupJid ? "Configurar" : "Escolher grupo"}
          </button>
        )}
      </div>

      {editing && (
        <div className="space-y-3 bg-[#080b12] border border-[#1e2d45] rounded-lg p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar grupo pelo nome…"
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
          />
          <div className="max-h-48 overflow-y-auto divide-y divide-[#1e2d45] border border-[#1e2d45] rounded">
            {groups === null && <div className="px-3 py-2 text-xs text-slate-500">Carregando…</div>}
            {groups?.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">Nenhum grupo encontrado. O grupo precisa ter ao menos uma conversa no WhatsApp do LeadHub.</div>
            )}
            {groups?.map((g) => (
              <button
                key={g.jid}
                type="button"
                onClick={() => { setJid(g.jid); setGName(g.name); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-[#0f1729] ${jid === g.jid ? "bg-indigo-500/10 text-white" : "text-slate-300"}`}
              >
                <span className="truncate">{g.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {g.ofClient && <span className="text-[10px] text-emerald-300">do cliente</span>}
                  {jid === g.jid && <Check className="w-3.5 h-3.5 text-indigo-300" />}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 flex-wrap text-xs text-slate-400">
            <label className="flex items-center gap-1.5">
              Lembrar após
              <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="w-14 bg-[#0a0f1a] border border-[#1e2d45] rounded px-1.5 py-0.5 text-slate-200" />
              dia(s) sem aprovar
            </label>
            <label className="flex items-center gap-1.5">
              no máximo
              <input type="number" min={0} max={10} value={max} onChange={(e) => setMax(Number(e.target.value))}
                className="w-14 bg-[#0a0f1a] border border-[#1e2d45] rounded px-1.5 py-0.5 text-slate-200" />
              lembretes
            </label>
          </div>
          <p className="text-[11px] text-slate-500">Lembretes só saem em dia útil, das 9h às 18h. Depois do último, o responsável pela tarefa é avisado.</p>
          {err && <div className="text-xs text-red-300">{err}</div>}
          <div className="flex items-center gap-2 justify-end">
            {project.approvalGroupJid && (
              <button type="button" onClick={() => save({ jid: "", name: "" })} disabled={saving} className="mr-auto text-xs text-slate-500 hover:text-red-300">
                Desligar aprovação pelo grupo
              </button>
            )}
            <button type="button" onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-white">Cancelar</button>
            <button
              type="button"
              onClick={() => save()}
              disabled={saving || !jid}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {waiting.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Esperando o cliente ({waiting.length})</div>
          <div className="divide-y divide-[#1e2d45] border border-[#1e2d45] rounded-lg">
            {waiting.map((t) => {
              const a = t.approval!;
              const stale = a.nudgeCount >= project.approvalMaxReminders && project.approvalMaxReminders > 0;
              return (
                <div key={t.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stale ? "bg-red-400" : a.viewedAt ? "bg-amber-400" : "bg-slate-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 truncate">{t.title}{a.round > 1 && <span className="text-slate-500"> · v{a.round}</span>}</div>
                    <div className="text-slate-500">
                      enviada {diasDesde(a.sentAt!)} · {viewSummary(a)}
                      {a.nudgeCount > 0 && ` · ${a.nudgeCount}/${project.approvalMaxReminders} lembrete${a.nudgeCount > 1 ? "s" : ""}`}
                      {stale && <span className="text-red-300"> · fale direto com o cliente</span>}
                    </div>
                  </div>
                  <CopyLink token={a.token} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        project.approvalGroupJid && !editing && (
          <p className="text-xs text-slate-500">
            Nada esperando o cliente. Abra uma tarefa, anexe a peça (ou escreva no descritivo) e clique em <span className="text-slate-300">Enviar pra aprovação</span>.
          </p>
        )
      )}

      {approved.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Aprovadas recentemente</div>
          <div className="space-y-1">
            {approved.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs text-slate-400">
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate text-slate-300">{t.title}</span>
                <span className="shrink-0">· {t.approval!.approvedBy ?? "cliente"} · {fmt(t.approval!.approvedAt!)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskApprovalBar({
  projectId, taskId, status, approval, hasGroup, onStatus,
}: {
  projectId: string;
  taskId: string;
  status: string;
  approval: TaskApproval | null;
  hasGroup: boolean;
  onStatus: (s: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState(approval?.token ?? null);

  async function send(viaGroup: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/projetos/${projectId}/tasks/${taskId}/aprovacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ send: viaGroup }),
    }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => null);
    if (!res?.ok) { setMsg({ ok: false, text: d?.error ?? "Não foi possível enviar." }); return; }
    onStatus("AGUARDANDO_CLIENTE");
    const t = String(d.url).split("/aprovar/")[1];
    setToken(t);
    if (!viaGroup) {
      await navigator.clipboard.writeText(d.url).catch(() => {});
      setMsg({ ok: true, text: `Link da versão ${d.round} copiado. Cole no WhatsApp do cliente.` });
    } else if (d.warning) {
      setMsg({ ok: false, text: d.warning });
    } else {
      setMsg({ ok: true, text: `Versão ${d.round} enviada no grupo.` });
    }
    router.refresh();
  }

  const waiting = status === "AGUARDANDO_CLIENTE" && approval?.sentAt;
  const label = !approval ? "Enviar pra aprovação" : waiting ? "Reenviar" : "Enviar nova versão";

  return (
    <div className="shrink-0 mb-2 flex items-center gap-2 flex-wrap text-[11px] bg-[#0a0f1a] border border-[#1e2d45] rounded-lg px-2.5 py-1.5">
      <span className="text-slate-500">Aprovação:</span>
      {!approval && <span className="text-slate-400">anexe a peça ou escreva no descritivo e envie</span>}
      {approval && status === "APROVADO" && approval.approvedAt && (
        <span className="text-emerald-300">✓ aprovada por {approval.approvedBy ?? "cliente"} em {fmt(approval.approvedAt)}</span>
      )}
      {waiting && (
        <span className="text-amber-300">
          v{approval!.round} enviada {diasDesde(approval!.sentAt!)} · cliente {viewSummary(approval!)}
          {approval!.nudgeCount > 0 && ` · ${approval!.nudgeCount} lembrete${approval!.nudgeCount > 1 ? "s" : ""}`}
        </span>
      )}
      {approval && !waiting && status !== "APROVADO" && <span className="text-slate-400">v{approval.round} voltou pra ajuste</span>}
      <span className="ml-auto flex items-center gap-2">
        {token && <CopyLink token={token} />}
        <button
          type="button"
          onClick={() => send(false)}
          disabled={busy || status === "APROVADO"}
          className="text-slate-400 hover:text-white disabled:opacity-40"
          title="Abre a rodada e copia o link, sem mandar no grupo"
        >
          só gerar link
        </button>
        <button
          type="button"
          onClick={() => send(true)}
          disabled={busy || !hasGroup || status === "APROVADO"}
          title={hasGroup ? "Manda o link no grupo do cliente" : "Configure o grupo em Aprovação pelo WhatsApp, no projeto"}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 font-semibold hover:bg-amber-500/25 disabled:opacity-40"
        >
          <Send className="w-3 h-3" /> {busy ? "Enviando…" : label}
        </button>
      </span>
      {msg && <div className={`basis-full ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</div>}
    </div>
  );
}

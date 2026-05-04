import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ScoreReason } from "@/generated/prisma";
import { REASON_LABEL } from "./labels";
import { formatBrazilDateTime } from "@/lib/datetime";

type Event = {
  id:           string;
  points:       number;
  reason:       ScoreReason;
  description:  string | null;
  authorName:   string | null;
  contextLabel?: string | null;
  contextHref?:  string | null;
  createdAt:    Date;
};

type Props = {
  events: Event[];
};

export default function RecentEvents({ events }: Props) {
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d45]">
        <h3 className="text-white font-semibold text-sm">📋 Histórico</h3>
        <p className="text-slate-500 text-xs mt-0.5">
          Últimos eventos de pontuação · clique no contexto pra abrir a origem
        </p>
      </div>

      {events.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-slate-500 text-sm">Nenhum evento registrado ainda.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2d45] max-h-[420px] overflow-y-auto">
          {events.map((ev) => {
            const meta       = REASON_LABEL[ev.reason];
            const isIncident = ev.reason === ScoreReason.INCIDENTE;
            return (
              <div key={ev.id} className="flex items-start justify-between px-5 py-3 gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${isIncident ? "text-red-300 font-medium" : "text-slate-200"}`}>
                    {isIncident ? "⚠️ " : ""}{meta.text}
                  </p>
                  {isIncident && ev.description && (
                    <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                      “{ev.description}”
                    </p>
                  )}
                  {ev.contextLabel && (
                    ev.contextHref ? (
                      <Link
                        href={ev.contextHref}
                        className="inline-flex items-center gap-1 mt-1 text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline truncate max-w-full"
                      >
                        <span className="truncate">{ev.contextLabel}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </Link>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-500 truncate">{ev.contextLabel}</p>
                    )
                  )}
                  <p className="text-slate-600 text-[11px] mt-0.5">
                    {formatBrazilDateTime(ev.createdAt)}
                    {isIncident && ev.authorName && (
                      <> · por <span className="text-slate-500">{ev.authorName}</span></>
                    )}
                  </p>
                </div>
                <span className={`font-bold text-sm flex-shrink-0 ${
                  ev.points > 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {ev.points > 0 ? "+" : ""}{ev.points}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

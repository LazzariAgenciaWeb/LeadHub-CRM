import { ScoreReason } from "@/generated/prisma";
import { REASON_LABEL } from "./labels";
import { formatBrazilDateTime } from "@/lib/datetime";

type Event = {
  id:        string;
  points:    number;
  reason:    ScoreReason;
  createdAt: Date;
};

type Props = {
  events: Event[];
};

export default function RecentEvents({ events }: Props) {
  return (
    <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d45]">
        <h3 className="text-white font-semibold text-sm">📋 Histórico</h3>
        <p className="text-slate-500 text-xs mt-0.5">Últimos eventos de pontuação</p>
      </div>

      {events.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-slate-500 text-sm">Nenhum evento registrado ainda.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1e2d45] max-h-[420px] overflow-y-auto">
          {events.map((ev) => {
            const meta = REASON_LABEL[ev.reason];
            return (
              <div key={ev.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-slate-200 text-sm truncate">{meta.text}</p>
                  <p className="text-slate-600 text-[11px] mt-0.5">
                    {formatBrazilDateTime(ev.createdAt)}
                  </p>
                </div>
                <span className={`font-bold text-sm flex-shrink-0 ml-3 ${
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

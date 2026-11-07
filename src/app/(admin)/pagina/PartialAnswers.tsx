import type { PartialAnswer } from "@/lib/bio-page-stats";

// Quem respondeu as perguntas e parou antes de deixar o contato. Anônimo —
// serve pra entender o que o público procura e onde desiste.

const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function PartialAnswers({ rows }: { rows: PartialAnswer[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
        Responderam e não deixaram contato ({rows.length})
      </h3>
      <p className="text-slate-500 text-[11px] mb-2">Sem nome nem telefone — só o que marcaram em cada etapa.</p>
      <ul className="divide-y divide-[#1e2d45] rounded-lg border border-[#1e2d45] bg-[#0b111c]">
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
              <span>{WHEN.format(new Date(r.updatedAt))}</span>
              <span>· {r.origin}</span>
              {r.reachedForm && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">parou no formulário</span>
              )}
            </div>
            <dl className="mt-1.5 space-y-1">
              {r.answers.map((a, i) => (
                <div key={i} className="text-xs">
                  <dt className="text-slate-500">{a.question}</dt>
                  <dd className="text-slate-200">{a.answer}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

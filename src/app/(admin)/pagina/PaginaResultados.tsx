"use client";

import { useState } from "react";
import { Eye, Lock, MessageCircle, MousePointerClick, Users } from "lucide-react";
import type { OwnerSummary } from "@/lib/bio-page-stats";

// Resultados do mês para o dono da página. No grátis: totais e nome/telefone
// dos contatos até o limite; no Starter, também as respostas de cada um.

const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long" });
const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function phoneLabel(digits: string): string {
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const m = local.match(/^(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${digits}`;
}

export default function PaginaResultados({ summary }: { summary: OwnerSummary }) {
  const [showAll, setShowAll] = useState(false);
  const month = MONTH.format(new Date(summary.since));
  const shown = showAll ? summary.contacts : summary.contacts.slice(0, 5);

  const cards = [
    { label: "Visitas", value: summary.views, Icon: Eye },
    { label: "Cliques", value: summary.clicks, Icon: MousePointerClick },
    { label: "Contatos", value: summary.contactsTotal, Icon: Users },
  ];

  return (
    <section className="mb-5 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
      <h2 className="text-white text-sm font-semibold">Resultados de {month}</h2>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {cards.map(({ label, value, Icon }) => (
          <div key={label} className="rounded-lg bg-[#0b111c] border border-[#1e2d45] p-3">
            <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
              <Icon className="w-3.5 h-3.5" /> {label}
            </div>
            <div className="text-white text-xl font-bold mt-1">{value.toLocaleString("pt-BR")}</div>
          </div>
        ))}
      </div>

      {summary.contactsTotal === 0 ? (
        <p className="text-slate-500 text-xs mt-3">
          Nenhum contato ainda este mês. Publique a página e coloque o link na bio do Instagram e no WhatsApp.
        </p>
      ) : (
        <div className="mt-4">
          <h3 className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-2">Contatos</h3>
          <ul className="divide-y divide-[#1e2d45] rounded-lg border border-[#1e2d45] bg-[#0b111c]">
            {shown.map((c) => (
              <li key={c.id} className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{c.name ?? "Sem nome"}</p>
                    <p className="text-xs text-slate-500">{phoneLabel(c.phone)} · {WHEN.format(new Date(c.createdAt))}</p>
                  </div>
                  <a
                    href={`https://wa.me/${c.phone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600/15 text-emerald-300 text-xs hover:bg-emerald-600/25"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Chamar
                  </a>
                </div>
                {c.answers && c.answers.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {c.answers.map((a, i) => (
                      <li key={i} className="text-[11px] text-slate-400">
                        <span className="text-slate-500">{a.question}</span> {a.answer}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {summary.contacts.length > 5 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-indigo-300 hover:text-white">
              {showAll ? "Mostrar menos" : `Ver todos (${summary.contacts.length})`}
            </button>
          )}
        </div>
      )}

      {summary.hidden > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
          <Lock className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100 leading-relaxed">
            <strong>+{summary.hidden} {summary.hidden === 1 ? "contato" : "contatos"} este mês</strong> que você ainda não vê.
            No Starter (R$ 49,90/mês) você vê todos, com as respostas de cada um — e ganha domínio com seu nome e e-mail profissional.
          </p>
        </div>
      )}

      {!summary.detailed && summary.contactsTotal > 0 && summary.hidden === 0 && (
        <p className="text-slate-600 text-[11px] mt-3">
          No Starter você também vê as respostas de cada contato e quais botões recebem mais cliques.
        </p>
      )}
    </section>
  );
}

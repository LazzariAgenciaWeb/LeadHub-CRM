import { notFound, redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { formatBrazilDateTime } from "@/lib/datetime";
import { PUNCH_LABEL, TIMEOFF_LABEL, WEEKDAY_SHORT, formatMin, monthLabel, parseYm } from "@/lib/ponto";
import { loadEspelho } from "@/lib/ponto-data";
import PrintBar from "./PrintBar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Espelho de ponto imprimível — documento branco, pensado pra "Salvar como
// PDF" e enviar ao escritório de contabilidade. Fica fora do grupo (admin)
// de propósito: sem sidebar, imprime limpo.
export default async function EspelhoPontoPage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const { userId } = await props.params;
  const { ym } = await props.searchParams;

  const viewerId = (session.user as any).id as string;
  const viewerRole = (session.user as any).role as string;
  const viewerCompanyId = (session.user as any).companyId as string | undefined;
  const isAdmin = viewerRole === "ADMIN" || viewerRole === "SUPER_ADMIN";

  // Só o próprio colaborador ou um admin da mesma empresa
  if (userId !== viewerId && !isAdmin) redirect("/ponto");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, companyId: true, company: { select: { name: true } } },
  });
  if (!user || !user.companyId) notFound();
  if (viewerRole !== "SUPER_ADMIN" && user.companyId !== viewerCompanyId) redirect("/ponto");

  const { year, month } = parseYm(ym);
  const { espelho, signature } = await loadEspelho(user.id, user.companyId, year, month);

  const occurrence = (d: (typeof espelho.days)[number]): string => {
    if (d.status === "ABONO" && d.timeOff) {
      return d.timeOffDesc ? `${TIMEOFF_LABEL[d.timeOff]} — ${d.timeOffDesc}` : TIMEOFF_LABEL[d.timeOff];
    }
    if (d.status === "FALTA") return "Falta";
    if (d.status === "INCOMPLETO") return "Marcação incompleta";
    if (d.status === "SEM_JORNADA" && d.punches.length === 0) return "—";
    return "";
  };

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white pb-10 print:pb-0">
      <PrintBar />

      <div className="max-w-[800px] mx-auto mt-4 print:mt-0 bg-white text-black shadow-lg print:shadow-none rounded-lg print:rounded-none p-8 print:p-0">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <div className="text-lg font-bold uppercase">Espelho de Ponto</div>
            <div className="text-sm">Competência: {monthLabel(year, month)}</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold">{user.company?.name}</div>
            <div className="text-xs text-neutral-600">Controle interno de jornada</div>
          </div>
        </div>

        {/* Identificação */}
        <div className="flex gap-8 py-3 text-sm border-b border-neutral-300">
          <div><span className="text-neutral-500">Colaborador: </span><b>{user.name}</b></div>
          <div><span className="text-neutral-500">E-mail: </span>{user.email}</div>
        </div>

        {/* Tabela de dias */}
        <table className="w-full text-xs mt-4 border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5 pr-2 font-semibold w-12">Dia</th>
              <th className="py-1.5 pr-2 font-semibold w-10">Sem.</th>
              <th className="py-1.5 pr-2 font-semibold">Marcações</th>
              <th className="py-1.5 pr-2 font-semibold w-20 text-right">Trabalhado</th>
              <th className="py-1.5 pr-2 font-semibold w-20 text-right">Previsto</th>
              <th className="py-1.5 font-semibold w-44">Ocorrência</th>
            </tr>
          </thead>
          <tbody>
            {espelho.days.map((d) => (
              <tr key={d.key} className={`border-b border-neutral-200 ${d.weekday === 0 || d.weekday === 6 ? "bg-neutral-50" : ""}`}>
                <td className="py-1 pr-2">{d.key.slice(8, 10)}</td>
                <td className="py-1 pr-2 uppercase text-neutral-500">{WEEKDAY_SHORT[d.weekday]}</td>
                <td className="py-1 pr-2">
                  {d.punches.length > 0
                    ? d.punches.map((p, i) => (
                        <span key={i} title={PUNCH_LABEL[p.type]}>
                          {i > 0 && " · "}{p.time}{p.source === "AJUSTE" ? "*" : ""}
                        </span>
                      ))
                    : "—"}
                </td>
                <td className="py-1 pr-2 text-right">{d.workedMin > 0 ? formatMin(d.workedMin) : "—"}</td>
                <td className="py-1 pr-2 text-right text-neutral-500">{d.expectedMin > 0 ? formatMin(d.expectedMin) : "—"}</td>
                <td className="py-1">{occurrence(d)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black font-semibold">
              <td colSpan={3} className="py-2">Totais do mês</td>
              <td className="py-2 pr-2 text-right">{formatMin(espelho.totals.workedMin)}</td>
              <td className="py-2 pr-2 text-right">{formatMin(espelho.totals.expectedMin)}</td>
              <td className="py-2">
                Saldo: {formatMin(espelho.totals.balanceMin)}
                {espelho.totals.faltas > 0 && ` · Faltas: ${espelho.totals.faltas}`}
                {espelho.totals.abonos > 0 && ` · Abonos: ${espelho.totals.abonos}`}
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="text-[10px] text-neutral-500 mt-1">* marcação incluída por ajuste aprovado pelo gestor</div>

        {/* Assinaturas */}
        <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
          <div>
            {signature ? (
              <div className="border border-neutral-400 rounded p-3 bg-neutral-50">
                <div className="font-semibold">✓ Assinado eletronicamente</div>
                <div className="mt-1">{user.name}</div>
                <div className="text-neutral-600">
                  em {formatBrazilDateTime(signature.signedAt)}
                  {signature.ip ? ` — IP ${signature.ip}` : ""}
                </div>
              </div>
            ) : (
              <div className="pt-10 border-t border-black text-center">
                {user.name}
                <div className="text-neutral-500">Assinatura do colaborador</div>
              </div>
            )}
          </div>
          <div className="pt-10 border-t border-black text-center self-end">
            <div className="text-neutral-500">Assinatura do responsável</div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="mt-8 pt-3 border-t border-neutral-300 text-[10px] text-neutral-500">
          Documento de controle interno de jornada gerado pelo LeadHub em {formatBrazilDateTime(new Date())}.
          Não substitui registro eletrônico de ponto (REP) nos termos da Portaria MTP 671/2021.
        </div>
      </div>
    </div>
  );
}

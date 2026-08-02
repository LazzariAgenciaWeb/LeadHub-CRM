import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { getAgentCalendarConnection, connectionCanWrite, computeAvailableSlots } from "@/lib/scheduling";

/**
 * GET /api/ai/assistants/[id]/test-agenda?calendarUserId=&duration=
 *
 * Diagnóstico do agendamento direto: percorre a cadeia inteira (agenda
 * selecionada → conexão Google ativa → permissão de escrita → consulta de
 * disponibilidade) e reporta EXATAMENTE onde parou. Usado pelo botão
 * "Testar agenda" no form do Assistente. Aceita overrides via query pra
 * testar o que está no form antes de salvar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "ai");
  if (!gate.ok) return gate.response;

  const role = (session.user as any).role as string;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { id } = await params;
  const assistant = await prisma.assistant.findUnique({
    where: { id },
    select: { companyId: true, calendarUserId: true, meetingDurationMin: true } as any,
  }) as { companyId: string; calendarUserId: string | null; meetingDurationMin: number } | null;
  if (!assistant) return NextResponse.json({ error: "Agente não encontrado" }, { status: 404 });
  if (role !== "SUPER_ADMIN" && assistant.companyId !== (session.user as any).companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const formCalendarUserId = q.get("calendarUserId") || null;
  const calendarUserId = formCalendarUserId || assistant.calendarUserId;
  const durationMin = Math.min(180, Math.max(15, parseInt(q.get("duration") ?? "", 10) || assistant.meetingDurationMin || 30));
  // O teste usa o valor do FORM; o motor em produção usa o SALVO. Se divergem,
  // o usuário selecionou mas não salvou — avisar com destaque.
  const notSaved = !!(formCalendarUserId && formCalendarUserId !== assistant.calendarUserId);

  // 1) Agenda selecionada?
  if (!calendarUserId) {
    return NextResponse.json({
      ok: false, step: "agenda",
      error: "Nenhuma agenda selecionada — escolha um usuário em '📅 Agendamento direto' e salve o agente.",
    });
  }

  // 2) Conexão Google ativa?
  const conn = await getAgentCalendarConnection(calendarUserId);
  if (!conn) {
    return NextResponse.json({
      ok: false, step: "conexao",
      error: "Este usuário não tem Google Calendar conectado (ou a conexão expirou). Conecte no módulo Calendário e tente de novo.",
    });
  }

  // 3) Permissão de criar eventos?
  if (!connectionCanWrite(conn)) {
    return NextResponse.json({
      ok: false, step: "permissao",
      error: `A conexão de ${conn.googleEmail ?? "conta Google"} está SEM a permissão de criar eventos. Desconecte e reconecte o Google — e na tela de permissões do Google, marque TODAS as caixinhas (inclusive a de eventos da agenda).`,
      scopes: conn.scopes,
    });
  }

  // 4) Consulta real de disponibilidade (freeBusy + horários de atendimento)
  try {
    const slots = await computeAvailableSlots({
      companyId: assistant.companyId,
      connectionId: conn.id,
      durationMin,
      maxSlots: 12,
    });
    const avisos: string[] = [];
    if (notSaved) avisos.push("A agenda testada ainda NÃO está salva no agente — clique em Salvar, senão o bot continua usando o link!");
    if (slots.length === 0) avisos.push("Conexão OK, mas nenhum horário livre nos próximos 3 dias úteis — agenda cheia ou horários de atendimento da empresa não configurados.");
    return NextResponse.json({
      ok: true,
      googleEmail: conn.googleEmail,
      durationMin,
      slotsCount: slots.length,
      sample: slots.slice(0, 6).map((s) => s.label),
      aviso: avisos.length ? avisos.join(" ") : null,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false, step: "google",
      error: `A consulta à agenda falhou: ${e?.message ?? "erro desconhecido"}. Se aparecer 403/insufficient, reconecte o Google marcando todas as permissões.`,
    });
  }
}

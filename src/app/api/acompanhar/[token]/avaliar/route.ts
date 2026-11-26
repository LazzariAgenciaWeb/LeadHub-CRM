import { NextRequest, NextResponse } from "next/server";
import { ticketByPublicToken } from "@/lib/ticket-public";
import { rateTicket } from "@/lib/ticket-confirm";

// POST /api/acompanhar/[token]/avaliar   Body: { name, rating: 1–5, comment? }
// Nota do cliente pro atendimento, depois do chamado encerrado. Fica no
// chamado (só a equipe vê) — o botão do Google é separado e vale pra todos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await ticketByPublicToken(token);
  if (!ticket) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const comment = String(body?.comment ?? "").trim().slice(0, 1000);
  if (name.length < 2) return NextResponse.json({ error: "Escreva seu nome." }, { status: 400 });

  const r = await rateTicket(ticket, name, Number(body?.rating), comment);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}

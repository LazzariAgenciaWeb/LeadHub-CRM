import { NextRequest, NextResponse } from "next/server";
import { ticketByPublicToken } from "@/lib/ticket-public";
import { confirmTicket } from "@/lib/ticket-confirm";

// POST /api/acompanhar/[token]/confirmar   Body: { name }
// Cliente confirma pelo link que o chamado resolvido ficou certo → Fechado
// (lib/ticket-confirm). Sem login: o token vale só pra este chamado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await ticketByPublicToken(token);
  if (!ticket) return NextResponse.json({ error: "Link inválido ou expirado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 80);
  if (name.length < 2) return NextResponse.json({ error: "Escreva seu nome." }, { status: 400 });

  const r = await confirmTicket(ticket, name);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, status: "CLOSED" });
}

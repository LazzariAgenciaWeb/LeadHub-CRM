import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustmentView, ADJ_SELECT, MAX_ADJ_TEXT } from "@/lib/approval-adjustments";

// PATCH/DELETE /api/aprovar/[token]/ajustes/[adjId]   Body: { deviceKey, text? }
//
// Quem anotou corrige ou tira o próprio ajuste — reconhecido pelo aparelho
// (deviceKey), já que o link não tem login. Só antes de ir pra equipe: depois
// de enviado, a equipe pode já estar trabalhando nele.
async function loadOwn(token: string, adjId: string, deviceKey: unknown) {
  if (typeof deviceKey !== "string" || !deviceKey) return { error: "Sem permissão", status: 403 } as const;
  const adj = await prisma.projectTaskAdjustment.findUnique({
    where:  { id: adjId },
    select: { id: true, deviceKey: true, sentAt: true, task: { select: { approvalToken: true } } },
  });
  if (!adj || adj.task.approvalToken !== token) return { error: "Ajuste não encontrado", status: 404 } as const;
  if (adj.deviceKey !== deviceKey) return { error: "Só quem anotou pode mudar este ajuste.", status: 403 } as const;
  if (adj.sentAt) return { error: "Este ajuste já foi enviado pra equipe.", status: 409 } as const;
  return { adj } as const;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string; adjId: string }> }) {
  const { token, adjId } = await params;
  const body = await req.json().catch(() => ({}));
  const r = await loadOwn(token, adjId, body?.deviceKey);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const text = String(body?.text ?? "").trim().slice(0, MAX_ADJ_TEXT);
  if (!text) return NextResponse.json({ error: "Escreva o que precisa mudar." }, { status: 400 });
  const row = await prisma.projectTaskAdjustment.update({ where: { id: adjId }, data: { text }, select: ADJ_SELECT });
  return NextResponse.json({ ok: true, adjustment: adjustmentView(row) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string; adjId: string }> }) {
  const { token, adjId } = await params;
  const body = await req.json().catch(() => ({}));
  const r = await loadOwn(token, adjId, body?.deviceKey);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  await prisma.projectTaskAdjustment.delete({ where: { id: adjId } });
  return NextResponse.json({ ok: true });
}

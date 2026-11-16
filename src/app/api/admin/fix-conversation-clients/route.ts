import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { applyConversationClientFix, formatPlan, planConversationClientFix } from "@/lib/conversation-client";

/**
 * Correção em lote: conversas do WhatsApp que apareciam como "a própria
 * agência" (cache de nome do webhook) ganham o cliente certo quando a
 * sugestão é clara; o resto fica "cliente indefinido" (nada a gravar).
 *
 *   GET  /api/admin/fix-conversation-clients?companyId=AGENCIA           → simulação (texto)
 *   GET  …&format=json                                                   → simulação (JSON)
 *   POST /api/admin/fix-conversation-clients  { companyId, apply: true, skip?: [id|telefone], onlyStrong?: true } → grava
 *   ("?" na simulação = só pelo nome parcial; pule com skip ou onlyStrong)
 *
 * Sem companyId: todas as agências (empresas com clientes na carteira).
 * Acesso: apenas SUPER_ADMIN real (sem impersonação). Idempotente.
 */

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }
  return null;
}

async function agencies(companyId: string | null) {
  if (companyId) return [companyId];
  const rows = await prisma.company.findMany({
    where: { subCompanies: { some: {} } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const ids = await agencies(sp.get("companyId"));
  const plans = [];
  for (const id of ids) plans.push(await planConversationClientFix(id));
  if (sp.get("format") === "json") return NextResponse.json({ dryRun: true, plans });
  const text = ["SIMULAÇÃO — nada foi gravado.", "", ...plans.map((p) => formatPlan(p.agency, p.rows, p.alreadyLinked))].join("\n");
  return new NextResponse(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (body.apply !== true) return NextResponse.json({ error: "Envie { apply: true } para gravar. Para simular use GET." }, { status: 400 });
  const ids = await agencies(body.companyId ?? null);
  const result = [];
  for (const id of ids) {
    const plan = await planConversationClientFix(id);
    const r = await applyConversationClientFix(id, plan.rows, {
      skip: Array.isArray(body.skip) ? body.skip.map(String) : [],
      onlyStrong: body.onlyStrong === true,
    });
    result.push({ agency: plan.agency, linked: r.linked, undefinedLeft: plan.rows.filter((x) => x.action === "INDEFINIDO").length });
  }
  return NextResponse.json({ ok: true, result });
}

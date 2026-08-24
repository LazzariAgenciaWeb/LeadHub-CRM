import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { cleanCobranca } from "@/lib/client-service-billing";
import { cleanVigencia } from "@/lib/client-service-vigencia";

const STATUSES = ["ATIVO", "EM_IMPLANTACAO", "PAUSADO", "ENCERRADO"];

function cleanDetails(raw: unknown): { label: string; value: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { label: string; value: string }[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const label = String((it as any).label ?? "").trim().slice(0, 80);
    const value = String((it as any).value ?? "").trim().slice(0, 500);
    if (!label && !value) continue;
    out.push({ label, value });
    if (out.length >= 30) break;
  }
  return out.length ? out : null;
}

async function loadAndAuth(session: any, companyId: string, csId: string) {
  const role = session.user?.role as string;
  const userCompanyId = session.user?.companyId as string | undefined;
  const cs = await prisma.clientService.findUnique({
    where: { id: csId },
    include: { clientCompany: { select: { id: true, parentCompanyId: true } } },
  });
  if (!cs || cs.clientCompanyId !== companyId) return { error: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  const ok = role === "SUPER_ADMIN" || cs.clientCompany.parentCompanyId === userCompanyId || cs.clientCompany.id === userCompanyId;
  if (!ok) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { cs, catalogOwnerId: cs.clientCompany.parentCompanyId ?? cs.clientCompany.id };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; csId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id, csId } = await params;
  const res = await loadAndAuth(session, id, csId);
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (body.label !== undefined && String(body.label).trim()) data.label = String(body.label).trim();
  if (body.status !== undefined && STATUSES.includes(body.status)) data.status = body.status;
  if (body.url !== undefined) data.url = body.url ? String(body.url).trim() : null;
  if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
  if (body.renewsAt !== undefined) {
    const d = body.renewsAt ? new Date(body.renewsAt) : null;
    data.renewsAt = d && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (body.details !== undefined) data.details = cleanDetails(body.details) ?? Prisma.DbNull;
  // Cobrança vem em bloco: mexer em "é recorrente" sem revisar ciclo e dia
  // deixaria combinação inválida (pontual guardando dia de vencimento).
  if (body.isRecurring !== undefined || body.amountCents !== undefined) {
    Object.assign(data, cleanCobranca(body));
  }
  if (body.serviceId !== undefined) {
    if (body.serviceId) {
      const svc = await prisma.service.findFirst({ where: { id: String(body.serviceId), companyId: res.catalogOwnerId }, select: { id: true } });
      data.serviceId = svc?.id ?? null;
    } else data.serviceId = null;
  }

  // Encerrar carimba a data sozinho; reabrir limpa. Ver client-service-vigencia.
  Object.assign(data, cleanVigencia(body, body.status, res.cs.status, res.cs.endedAt));

  const updated = await prisma.clientService.update({
    where: { id: csId },
    data,
    include: { service: { select: { id: true, name: true } } },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; csId: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id, csId } = await params;
  const res = await loadAndAuth(session, id, csId);
  if ("error" in res) return res.error;
  await prisma.clientService.delete({ where: { id: csId } });
  return NextResponse.json({ ok: true });
}

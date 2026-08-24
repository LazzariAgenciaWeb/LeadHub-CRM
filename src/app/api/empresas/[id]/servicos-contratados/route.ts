import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { cleanCobranca } from "@/lib/client-service-billing";
import { cleanVigencia } from "@/lib/client-service-vigencia";

const STATUSES = ["ATIVO", "EM_IMPLANTACAO", "PAUSADO", "ENCERRADO"];

// Normaliza os "campos extras" flexíveis pra [{ label, value }].
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

// Autoriza: super-admin, ou ADMIN da agência-mãe do cliente (parentCompanyId),
// ou a própria empresa. Retorna a empresa-alvo ou um erro.
async function authorize(session: any, companyId: string) {
  const role = session.user?.role as string;
  const userCompanyId = session.user?.companyId as string | undefined;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!company) return { error: NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 }) };
  const ok = role === "SUPER_ADMIN" || company.parentCompanyId === userCompanyId || company.id === userCompanyId;
  if (!ok) return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  // Catálogo pertence à agência (mãe) — ou à própria empresa se for top-level.
  const catalogOwnerId = company.parentCompanyId ?? company.id;
  return { company, catalogOwnerId };
}

// POST /api/empresas/[id]/servicos-contratados
// Body: { serviceId?, label, status?, renewsAt?, url?, notes?, details?,
//         amountCents?, isRecurring?, billingCycle?, billingDay? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const auth = await authorize(session, id);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const label = String(body?.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Dê um nome/apelido ao serviço" }, { status: 400 });

  // serviceId opcional — valida que é do catálogo da agência.
  let serviceId: string | null = null;
  if (body?.serviceId) {
    const svc = await prisma.service.findFirst({
      where: { id: String(body.serviceId), companyId: auth.catalogOwnerId },
      select: { id: true },
    });
    serviceId = svc?.id ?? null;
  }
  const status = STATUSES.includes(body?.status) ? body.status : "ATIVO";
  const renewsAt = body?.renewsAt ? new Date(body.renewsAt) : null;

  const created = await prisma.clientService.create({
    data: {
      clientCompanyId: id,
      serviceId,
      label,
      status,
      renewsAt: renewsAt && !Number.isNaN(renewsAt.getTime()) ? renewsAt : null,
      url:    body?.url ? String(body.url).trim() : null,
      notes:  body?.notes ? String(body.notes) : null,
      details: cleanDetails(body?.details) ?? undefined,
      ...cleanCobranca(body),
      ...cleanVigencia(body, status, "", null),
      provider: "manual",
    },
    include: { service: { select: { id: true, name: true } } },
  });
  return NextResponse.json(created, { status: 201 });
}

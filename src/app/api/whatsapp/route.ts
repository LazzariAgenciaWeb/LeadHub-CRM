import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { buildInstanceSlug, evolutionCreateInstance } from "@/lib/evolution";
import { buildWhatsappWebhookUrl } from "@/lib/webhook-auth";

// GET /api/whatsapp?companyId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // fix A3 — gate de módulo whatsapp
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  const where = effectiveCompanyId ? { companyId: effectiveCompanyId } : {};

  const instances = await prisma.whatsappInstance.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(instances);
}

// POST /api/whatsapp
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const body = await req.json();
  const { label, phone, companyId } = body;

  const friendlyLabel = String(label ?? "").trim();
  if (!friendlyLabel) {
    return NextResponse.json({ error: "Dê um nome para a instância" }, { status: 400 });
  }

  const effectiveCompanyId =
    userRole === "SUPER_ADMIN" ? companyId : userCompanyId;

  if (!effectiveCompanyId) {
    return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });
  }

  const company = await prisma.company.findUnique({
    where: { id: effectiveCompanyId },
    select: { name: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }

  // Slug técnico único pra Evolution. O sufixo aleatório torna colisão
  // improvável; ainda assim regeneramos se já existir no banco.
  let slug = buildInstanceSlug(company.name);
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.whatsappInstance.findFirst({
      where: { instanceName: slug },
      select: { id: true },
    });
    if (!clash) break;
    slug = buildInstanceSlug(company.name);
  }

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const webhookUrl = buildWhatsappWebhookUrl(origin);

  // Cria na Evolution AGORA (passo explícito). Se falhar, não criamos a
  // linha no banco — sem instância "pela metade". O erro real sobe pra UI.
  let instanceToken: string | null = null;
  try {
    const createResult = await evolutionCreateInstance(slug, webhookUrl);
    instanceToken =
      createResult?.hash?.apikey ??
      createResult?.instance?.token ??
      createResult?.token ??
      null;
  } catch (err: any) {
    return NextResponse.json(
      { error: `Não foi possível criar a instância na Evolution API: ${err?.message ?? err}` },
      { status: 502 },
    );
  }

  const instance = await (prisma.whatsappInstance.create as any)({
    data: {
      instanceName: slug,
      label: friendlyLabel,
      phone: phone || null,
      webhookUrl,
      instanceToken,
      companyId: effectiveCompanyId,
      status: "DISCONNECTED",
    },
    include: { company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(instance, { status: 201 });
}

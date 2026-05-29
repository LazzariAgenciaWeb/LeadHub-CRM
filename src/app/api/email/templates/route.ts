import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

function companyIdFor(session: any, fallback?: string | null): string | null {
  const role = session.user.role as string;
  if (role === "SUPER_ADMIN") return fallback ?? session.user.companyId ?? null;
  return session.user.companyId ?? null;
}

// GET /api/email/templates?companyId=
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const companyId = companyIdFor(session, req.nextUrl.searchParams.get("companyId"));
  if (!companyId) return NextResponse.json([]);

  const templates = await prisma.emailTemplate.findMany({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, subject: true, html: true, text: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(templates);
}

// POST /api/email/templates  { name, subject, html, text? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const companyId = companyIdFor(session, body.companyId);
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  const name = (body.name ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const html = (body.html ?? "").trim();
  if (!name || !subject || !html) {
    return NextResponse.json({ error: "name, subject e html são obrigatórios" }, { status: 400 });
  }

  const template = await prisma.emailTemplate.create({
    data: { name, subject, html, text: body.text?.trim() || null, companyId },
  });
  return NextResponse.json(template, { status: 201 });
}

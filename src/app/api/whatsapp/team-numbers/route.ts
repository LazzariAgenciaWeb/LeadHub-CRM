import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { getTeamNumbers } from "@/lib/whatsapp";

// Gerencia os "números da equipe" de uma empresa — telefones que são NOSSOS mas
// não são instâncias do LeadHub (ex.: celular pessoal do dono em grupos).
// Armazenados no Setting `team_numbers:{companyId}` como JSON de dígitos.
//
// GET    ?companyId=  → lista
// POST   { phone }    → adiciona (normaliza p/ dígitos), retorna lista
// DELETE { phone }    → remove, retorna lista

async function resolveCompanyId(req: NextRequest, session: any): Promise<string | null> {
  const role = session?.user?.role;
  const userCompanyId = session?.user?.companyId as string | undefined;
  if (role === "SUPER_ADMIN") {
    // super admin pode operar em qualquer empresa via ?companyId= ou body.companyId
    const fromUrl = new URL(req.url).searchParams.get("companyId");
    if (fromUrl) return fromUrl;
    return null; // resolvido depois pelo body em POST/DELETE
  }
  return userCompanyId ?? null;
}

async function saveTeamNumbers(companyId: string, numbers: string[]) {
  const value = JSON.stringify([...new Set(numbers)]);
  await prisma.setting.upsert({
    where: { key: `team_numbers:${companyId}` },
    create: { key: `team_numbers:${companyId}`, value },
    update: { value },
  });
}

export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const companyId = await resolveCompanyId(req, session);
  if (!companyId) return NextResponse.json({ numbers: [] });

  return NextResponse.json({ numbers: await getTeamNumbers(companyId) });
}

export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any)?.role;
  const companyId =
    (await resolveCompanyId(req, session)) ??
    (role === "SUPER_ADMIN" ? (body.companyId as string | undefined) : undefined);
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });

  const digits = String(body.phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) {
    return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });
  }

  const current = await getTeamNumbers(companyId);
  const next = [...new Set([...current, digits])];
  await saveTeamNumbers(companyId, next);

  return NextResponse.json({ numbers: next });
}

export async function DELETE(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const role = (session.user as any)?.role;
  const companyId =
    (await resolveCompanyId(req, session)) ??
    (role === "SUPER_ADMIN" ? (body.companyId as string | undefined) : undefined);
  if (!companyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });

  const digits = String(body.phone ?? "").replace(/\D/g, "");
  const current = await getTeamNumbers(companyId);
  const next = current.filter((n) => n !== digits && n.replace(/^55/, "") !== digits.replace(/^55/, ""));
  await saveTeamNumbers(companyId, next);

  return NextResponse.json({ numbers: next });
}

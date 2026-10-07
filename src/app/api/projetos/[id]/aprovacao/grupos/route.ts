import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

// GET /api/projetos/[id]/aprovacao/grupos?q=
// Grupos do WhatsApp pra escolher o grupo de aprovação do projeto. Os grupos
// já ligados ao cliente do projeto vêm primeiro; depois os da agência que
// casam com a busca.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const project = await prisma.setorClickupList.findUnique({
    where:  { id },
    select: { clientCompanyId: true, setor: { select: { companyId: true } } },
  });
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
  const agencyId = project.setor.companyId;
  if (role !== "SUPER_ADMIN" && agencyId !== userCompanyId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const companyIds = [agencyId, ...(project.clientCompanyId ? [project.clientCompanyId] : [])];
  const contacts = await prisma.companyContact.findMany({
    where: {
      isGroup: true,
      phone: { endsWith: "@g.us" },
      companyId: { in: companyIds },
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    select: { phone: true, name: true, companyId: true },
    take: 200,
  });

  // Só grupos em que a agência já conversou (a instância está dentro).
  const convs = await prisma.conversation.findMany({
    where:  { companyId: agencyId, phone: { in: contacts.map((c) => c.phone) } },
    select: { phone: true, lastMessageAt: true },
  });
  const lastAt = new Map(convs.map((c) => [c.phone, c.lastMessageAt?.getTime() ?? 0]));

  const groups = contacts
    .filter((c) => lastAt.has(c.phone))
    .map((c) => ({ jid: c.phone, name: c.name ?? c.phone, ofClient: c.companyId === project.clientCompanyId, lastAt: lastAt.get(c.phone)! }))
    .sort((a, b) => Number(b.ofClient) - Number(a.ofClient) || b.lastAt - a.lastAt)
    .slice(0, 30);

  return NextResponse.json({ groups });
}

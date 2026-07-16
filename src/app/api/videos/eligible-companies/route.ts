import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";
import { videoActorScope } from "@/lib/videos";

// GET /api/videos/eligible-companies — empresas que o usuário pode LIBERAR
// (destino das trilhas com visibility=SELECTED):
//   SUPER_ADMIN → todas as empresas com acesso ao sistema.
//   ADMIN       → sub-empresas (clientes) da própria agência.
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "videos");
  if (!gate.ok) return gate.response;

  const actor = videoActorScope(session);
  if (!actor) return NextResponse.json({ error: "Sem empresa associada" }, { status: 403 });

  const companies = await prisma.company.findMany({
    where:
      actor.scope === "GLOBAL"
        ? { hasSystemAccess: true }
        : { parentCompanyId: actor.companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentCompany: { select: { name: true } } },
  });

  return NextResponse.json({
    companies: companies.map((c) => ({ id: c.id, name: c.name, agency: c.parentCompany?.name ?? null })),
  });
}

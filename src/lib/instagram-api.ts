/**
 * Helpers das rotas client-facing do módulo Instagram (/api/instagram/*).
 * Gateia por sessão efetiva + módulo `instagram` + empresa no contexto.
 */
import { NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export type IgContext =
  | { ok: true; companyId: string }
  | { ok: false; res: NextResponse };

/** Resolve a empresa do contexto (ADMIN da empresa ou SUPER_ADMIN impersonando). */
export async function requireInstagramCompany(): Promise<IgContext> {
  const session = await getEffectiveSession();
  if (!session) return { ok: false, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const gate = await assertModule(session, "instagram");
  if (!gate.ok) return { ok: false, res: gate.response };

  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Sem empresa no contexto. Logue como admin da empresa ou use a visualização como cliente." },
        { status: 400 },
      ),
    };
  }
  return { ok: true, companyId };
}

/** A conta IG conectada da empresa (ou null). */
export async function getCompanyAccount(companyId: string) {
  return prisma.instagramAccount.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
}

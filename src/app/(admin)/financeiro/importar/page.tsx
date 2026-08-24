import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { LISTA_CONTRATOS_PADRAO } from "@/lib/clickup-contratos";
import ImportarClickup from "./ImportarClickup";

export const dynamic = "force-dynamic";

export default async function ImportarPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const token = agencyId
    ? (await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } }))?.value
    : null;

  return (
    <ImportarClickup
      listaPadrao={LISTA_CONTRATOS_PADRAO}
      temEmpresa={!!agencyId}
      temToken={!!token?.trim()}
    />
  );
}

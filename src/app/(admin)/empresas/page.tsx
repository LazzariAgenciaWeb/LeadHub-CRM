import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EmpresasClient from "./EmpresasClient";
import { can } from "@/lib/permissions";

// Usa getServerSession (sessão real), não getEffectiveSession.
// Gerir empresas (deletar, transferir, criar) é ação de SUPER_ADMIN e não deve
// respeitar o cookie de impersonation — se o admin clicou "Visualizar como cliente"
// e voltou pra cá, ele continua sendo SUPER_ADMIN nesta tela.
export default async function EmpresasPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const userCompanyId = (session?.user as any)?.companyId;

  if (!session) redirect("/login");

  // CLIENT sem canViewCompanies → sem acesso
  if (role === "CLIENT" && !can(session, "canViewCompanies")) redirect("/dashboard");

  let companies: any[] = [];
  let isSuperAdmin = role === "SUPER_ADMIN";
  let parentCompanyName: string | null = null;

  if (isSuperAdmin) {
    companies = await prisma.company.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { leads: true, campaigns: true, whatsappInstances: true, subCompanies: true },
        },
        parentCompany: { select: { id: true, name: true } },
      },
    });
  } else if (userCompanyId) {
    // CLIENT: vê apenas suas sub-empresas (clientes que cadastrou)
    const [myCompany, subCompanies] = await Promise.all([
      prisma.company.findUnique({ where: { id: userCompanyId }, select: { name: true } }),
      prisma.company.findMany({
        where: { parentCompanyId: userCompanyId },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { leads: true, campaigns: true, whatsappInstances: true, subCompanies: true } },
        },
      }),
    ]);
    parentCompanyName = myCompany?.name ?? null;
    companies = subCompanies;
  } else {
    redirect("/dashboard");
  }

  return (
    <EmpresasClient
      companies={companies as any}
      isSuperAdmin={isSuperAdmin}
      parentCompanyName={parentCompanyName}
    />
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import EmpresasClient from "./EmpresasClient";
import { getEffectiveSession } from "@/lib/effective-session";
import { can } from "@/lib/permissions";

export default async function EmpresasPage() {
  const session = await getEffectiveSession();
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

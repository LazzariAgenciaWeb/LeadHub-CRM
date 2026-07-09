import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Empresa-cliente (sub-company) cai no painel dela; agência, no dashboard.
  const companyId = (session.user as any)?.companyId as string | undefined;
  const role = (session.user as any)?.role as string | undefined;
  if (companyId && role !== "SUPER_ADMIN") {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { parentCompanyId: true },
    });
    if (company?.parentCompanyId) redirect("/meu-espaco");
  }
  redirect("/dashboard");
}

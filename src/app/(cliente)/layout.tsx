import { redirect } from "next/navigation";
import ClientShell from "@/components/ClientShell";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import IconGradients from "@/components/IconGradients";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { hasModule } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Área do cliente logado — casca limpa (sem menu da agência). Só empresas
// cliente (sub-company) entram aqui; agência/super-admin vão pro sistema normal.
export default async function ClienteLayout({ children }: { children: React.ReactNode }) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const companyId = (session.user as any)?.companyId as string | undefined;
  const role = (session.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, parentCompanyId: true, fullSystemAccess: true, parentCompany: { select: { name: true } } },
  });
  if (!company?.parentCompanyId) redirect("/dashboard");

  const impersonating = isImpersonating(session);
  const impersonatedCompany = (session as any)._impersonating;
  const banner =
    impersonating && impersonatedCompany ? (
      <ImpersonationBanner companyName={impersonatedCompany.companyName} />
    ) : null;

  return (
    <>
      <IconGradients />
      <ClientShell clientName={company.name} agencyName={company.parentCompany?.name ?? "Portal"} banner={banner} fullSystemAccess={company.fullSystemAccess} showVideos={hasModule(session, "videos")}>
        {children}
      </ClientShell>
    </>
  );
}

import { redirect } from "next/navigation";
import LayoutShell from "@/components/LayoutShell";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import IconGradients from "@/components/IconGradients";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getEffectiveSession();

  if (!session) {
    redirect("/login");
  }

  const impersonating = isImpersonating(session);
  const impersonatedCompany = (session as any)._impersonating;

  const banner =
    impersonating && impersonatedCompany ? (
      <ImpersonationBanner companyName={impersonatedCompany.companyName} />
    ) : null;

  // Empresa cliente (sub-company) usa o sistema normal (com os módulos que ela
  // contratou), mas ganha o atalho "Meu espaço" no menu. Só detectamos aqui pra
  // acender o item — a área do cliente em si vive no grupo (cliente).
  const companyId = (session.user as any)?.companyId as string | undefined;
  const role = (session.user as any)?.role as string | undefined;
  let isClient = false;
  if (companyId && role !== "SUPER_ADMIN") {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { parentCompanyId: true },
    });
    isClient = !!company?.parentCompanyId;
  }

  return (
    <>
      {/* Defs SVG dos gradientes — fica disponível pra qualquer ícone Lucide */}
      <IconGradients />
      <LayoutShell session={session} banner={banner} isClient={isClient}>
        {children}
      </LayoutShell>
    </>
  );
}

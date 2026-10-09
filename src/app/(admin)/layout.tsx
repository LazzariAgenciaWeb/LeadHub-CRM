import { redirect } from "next/navigation";
import LayoutShell from "@/components/LayoutShell";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import IconGradients from "@/components/IconGradients";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { clientIp, learnInternalIp } from "@/lib/internal-ip";

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
      <ImpersonationBanner
        companyName={impersonatedCompany.companyName}
        actingAs={impersonatedCompany.actingAs ?? null}
      />
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
      select: { parentCompanyId: true, fullSystemAccess: true },
    });
    isClient = !!company?.parentCompanyId;
    // Cliente sem acesso completo → só o Meu Espaço (não entra no sistema da agência).
    // EXCEÇÃO: quando é SUPER_ADMIN impersonando, não trava — ele está inspecionando.
    if (isClient && !company?.fullSystemAccess && !impersonating) redirect("/meu-espaco");
  }

  // IP da equipe: quem é da agência (ou da plataforma) usando o LeadHub ensina
  // a rede dela, pra o acesso interno ao link de aprovação não contar como
  // "cliente viu". Cliente com acesso ao sistema não entra (é visita real).
  if (!isClient) {
    const ip = clientIp(await headers());
    const realSuper = role === "SUPER_ADMIN" || impersonating;
    void learnInternalIp(realSuper ? null : companyId ?? null, ip, (session.user as any)?.id ?? null);
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

import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import HostingPanel, { type HostingRow } from "./HostingPanel";

export const dynamic = "force-dynamic";

/**
 * Gestão → Hospedagem: todas as contas cPanel da agência num lugar só —
 * a da própria agência e as dos clientes. A lista vem do banco; espaço e
 * caixas de e-mail o painel consulta ao vivo em cada cPanel.
 */
export default async function HospedagemPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

  const user = session.user as { role?: string; companyId?: string } | undefined;
  const role = user?.role ?? "";
  // Mesmo recorte das rotas do cPanel: só ADMIN/SUPER_ADMIN.
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") redirect("/dashboard");

  const agencyId = user?.companyId;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const integrations = await prisma.cpanelIntegration.findMany({
    where: isGlobal
      ? {}
      : { company: { OR: [{ id: agencyId ?? "__none__" }, { parentCompanyId: agencyId ?? "__none__" }] } },
    select: {
      companyId: true, host: true, username: true, siteUrl: true, publishDir: true, status: true,
      lastTestedAt: true, lastError: true, clientCanManageEmail: true,
      company: { select: { name: true, tradeName: true, parentCompanyId: true } },
    },
  });

  // Clientes que ainda não têm cPanel ligado: atalho pra configurar.
  const withoutCpanel = isGlobal ? [] : await prisma.company.findMany({
    where: { parentCompanyId: agencyId ?? "__none__", cpanelIntegration: null },
    select: { id: true, name: true, tradeName: true },
    orderBy: { name: "asc" },
  });

  const rows: HostingRow[] = integrations
    .map((i) => ({
      companyId: i.companyId,
      name: i.company.tradeName || i.company.name,
      isOwn: i.companyId === agencyId,
      host: i.host,
      username: i.username,
      siteUrl: i.siteUrl,
      publishDir: i.publishDir,
      status: i.status,
      lastTestedAt: i.lastTestedAt?.toISOString() ?? null,
      lastError: i.lastError,
      clientPortal: i.clientCanManageEmail,
    }))
    .sort((a, b) => (a.isOwn === b.isOwn ? a.name.localeCompare(b.name, "pt-BR") : a.isOwn ? -1 : 1));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-white text-xl font-bold">Hospedagem</h1>
        <p className="text-slate-400 text-sm">Servidor, espaço e caixas de e-mail de cada conta cPanel — a sua e a dos clientes.</p>
      </div>
      <HostingPanel
        rows={rows}
        withoutCpanel={withoutCpanel.map((c) => ({ id: c.id, name: c.tradeName || c.name }))}
      />
    </div>
  );
}

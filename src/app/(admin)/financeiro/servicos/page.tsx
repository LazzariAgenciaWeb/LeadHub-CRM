import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import ServicosPanel, { type ServicosData } from "./ServicosPanel";
import { nomeCliente as fmtCliente } from "../lib";

export const dynamic = "force-dynamic";

/**
 * Padronização de serviços contratados da carteira inteira: a importação do
 * ClickUp trouxe a mesma hospedagem com dezenas de nomes e sem vínculo com o
 * catálogo — aqui se seleciona em massa e se vincula/renomeia de uma vez.
 */
export default async function ServicosPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const isGlobal = role === "SUPER_ADMIN" && !agencyId;

  const clients = await prisma.company.findMany({
    where: isGlobal ? { parentCompanyId: { not: null } } : { parentCompanyId: agencyId },
    select: { id: true, name: true, tradeName: true },
  });
  const clientIds = clients.map((c) => c.id);
  // Fantasia na frente, razão social entre parênteses — ver `nomeCliente`.
  const nomeCliente = new Map(clients.map((c) => [c.id, fmtCliente(c)] as const));

  const [contratos, catalogo] = await Promise.all([
    prisma.clientService.findMany({
      where: { clientCompanyId: { in: clientIds } },
      orderBy: [{ label: "asc" }],
      select: {
        id: true, label: true, status: true, amountCents: true, isRecurring: true,
        clientCompanyId: true, serviceId: true,
        service: { select: { name: true } },
      },
    }),
    prisma.service.findMany({
      where: isGlobal ? {} : { companyId: agencyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const data: ServicosData = {
    catalogo,
    contratos: contratos.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      amountCents: c.amountCents ?? 0,
      isRecurring: c.isRecurring,
      cliente: nomeCliente.get(c.clientCompanyId) ?? "—",
      clienteId: c.clientCompanyId,
      catalogo: c.service?.name ?? null,
      catalogoId: c.serviceId,
    })),
  };

  return <ServicosPanel data={data} />;
}

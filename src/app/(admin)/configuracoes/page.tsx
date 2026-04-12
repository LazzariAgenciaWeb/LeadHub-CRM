import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import SettingsLayout from "./SettingsLayout";
import SettingsForm from "./SettingsForm";
import InstancesSection from "./InstancesSection";
import PipelineSettings from "./PipelineSettings";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ secao?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const secao = sp.secao ?? "instancias";
  const effectiveCompanyId = isSuperAdmin ? undefined : userCompanyId;

  const webhookBaseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  let content: React.ReactNode;

  if (secao === "instancias") {
    const instanceWhere = isSuperAdmin ? {} : { companyId: userCompanyId ?? "" };

    const [instances, companies] = await Promise.all([
      prisma.whatsappInstance.findMany({
        where: instanceWhere,
        orderBy: { createdAt: "desc" },
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
      isSuperAdmin
        ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
        : [],
    ]);

    content = (
      <InstancesSection
        instances={instances as any}
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        defaultCompanyId={userCompanyId ?? ""}
        webhookBaseUrl={webhookBaseUrl}
      />
    );
  } else {
    // empresa + integracoes — usa o SettingsForm existente
    const settingsRaw = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    let company = null;
    if (userCompanyId) {
      company = await prisma.company.findUnique({
        where: { id: userCompanyId },
        select: { id: true, name: true, phone: true, email: true, website: true, segment: true, logoUrl: true },
      });
    }

    const showEmpresa = secao === "empresa";
    const showIntegracoes = secao === "integracoes";

    content = (
      <div className="p-6 max-w-2xl">
        {showEmpresa && (
          <SettingsForm isSuperAdmin={false} settings={{}} company={company} onlyCompany />
        )}
        {showIntegracoes && (
          <SettingsForm isSuperAdmin={isSuperAdmin} settings={settings} company={null} onlyIntegrations />
        )}
      </div>
    );
  }

  if (secao === "pipeline") {
    // Para SUPER_ADMIN sem companyId próprio, usa a primeira empresa do sistema
    let pipelineCompanyId = userCompanyId;
    if (!pipelineCompanyId) {
      const firstCompany = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      pipelineCompanyId = firstCompany?.id;
    }

    const pipelineStages = pipelineCompanyId
      ? await prisma.pipelineStageConfig.findMany({
          where: { companyId: pipelineCompanyId },
          orderBy: [{ pipeline: "asc" }, { order: "asc" }],
        })
      : [];

    content = (
      <PipelineSettings
        initialStages={pipelineStages}
        companyId={pipelineCompanyId ?? ""}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SettingsLayout activeSection={secao}>
        {content}
      </SettingsLayout>
    </div>
  );
}

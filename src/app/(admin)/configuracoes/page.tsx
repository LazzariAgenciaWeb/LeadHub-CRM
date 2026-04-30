import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import SettingsLayout from "./SettingsLayout";
import SettingsForm from "./SettingsForm";
import InstancesSection from "./InstancesSection";
import PipelineSettings from "./PipelineSettings";
import ClickupSettings from "./ClickupSettings";
import OpenAISettings from "./OpenAISettings";
import SetoresSection from "./SetoresSection";
import WebhookSettings from "./WebhookSettings";
import AtendimentoSettings from "./AtendimentoSettings";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ secao?: string; companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const sp = await searchParams;
  const secao = sp.secao ?? "instancias";
  const qCompanyId = sp.companyId;

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
  } else if (secao === "empresa") {
    let company = null;
    if (userCompanyId) {
      company = await prisma.company.findUnique({
        where: { id: userCompanyId },
        select: { id: true, name: true, phone: true, email: true, website: true, segment: true, logoUrl: true },
      });
    }
    content = (
      <div className="p-6 max-w-2xl">
        <SettingsForm isSuperAdmin={false} settings={{}} company={company} onlyCompany />
      </div>
    );
  } else if (secao === "integracoes-evolution" || secao === "integracoes") {
    // Legacy "integracoes" redirects to Evolution sub-section
    const settingsRaw = await prisma.setting.findMany();
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    content = (
      <div className="p-6 max-w-2xl">
        <SettingsForm isSuperAdmin={isSuperAdmin} settings={settings} company={null} onlyIntegrations />
      </div>
    );
  } else if (secao === "integracoes-clickup") {
    const settingsRaw = await prisma.setting.findMany({
      where: {
        key: { in: ["clickup_api_token", "clickup_oportunidades_list_id", "clickup_tickets_list_id"] },
      },
    });
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    content = <ClickupSettings settings={settings} />;
  } else if (secao === "integracoes-webhook") {
    const companyId = userCompanyId ?? "";
    let webhookToken: string | null = null;
    if (companyId) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { webhookToken: true },
      });
      webhookToken = company?.webhookToken ?? null;
    }
    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";
    content = (
      <WebhookSettings
        companyId={companyId}
        webhookToken={webhookToken}
        baseUrl={baseUrl}
      />
    );
  } else if (secao === "integracoes-openai") {
    const settingsRaw = await prisma.setting.findMany({
      where: { key: { in: ["openai_api_key", "openai_model"] } },
    });
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    content = <OpenAISettings settings={settings} />;
  } else if (secao === "pipeline") {
    // SuperAdmin pode escolher empresa via ?companyId=X
    // Se não informado, usa o companyId da sessão (quando impersonando ou é ADMIN)
    let pipelineCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;

    // Fallback: primeira empresa do sistema
    if (!pipelineCompanyId) {
      const firstCompany = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      pipelineCompanyId = firstCompany?.id;
    }

    const [pipelineStages, allCompanies] = await Promise.all([
      pipelineCompanyId
        ? prisma.pipelineStageConfig.findMany({
            where: { companyId: pipelineCompanyId },
            orderBy: [{ pipeline: "asc" }, { order: "asc" }],
          })
        : Promise.resolve([]),
      isSuperAdmin
        ? prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    content = (
      <PipelineSettings
        initialStages={pipelineStages}
        companyId={pipelineCompanyId ?? ""}
        isSuperAdmin={isSuperAdmin}
        allCompanies={allCompanies}
        selectedCompanyId={pipelineCompanyId ?? ""}
      />
    );
  } else if (secao === "setores") {
    const companyId = userCompanyId ?? "";
    const [setores, allUsers, allInstances] = await Promise.all([
      prisma.setor.findMany({
        where: { companyId },
        include: {
          users:     { include: { user: { select: { id: true, name: true, email: true } } } },
          instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
          _count:    { select: { tickets: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: { companyId, role: "CLIENT" },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      prisma.whatsappInstance.findMany({
        where: { companyId },
        select: { id: true, instanceName: true, phone: true, status: true },
        orderBy: { instanceName: "asc" },
      }),
    ]);
    content = (
      <SetoresSection
        initialSetores={setores as any}
        allUsers={allUsers}
        allInstances={allInstances as any}
      />
    );
  } else if (secao === "atendimento") {
    const cId = userCompanyId ?? "";
    const settingsRaw = await prisma.setting.findMany({
      where: {
        key: { in: [
          `sla_minutes:${cId}`,
          `out_of_hours_message:${cId}`,
          `business_hours:${cId}`,
        ] },
      },
    });
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    const sla = parseInt(settings[`sla_minutes:${cId}`] ?? "15", 10);
    const ooh = settings[`out_of_hours_message:${cId}`] ?? "";
    const bhRaw = settings[`business_hours:${cId}`] ?? "";
    const bh = bhRaw && bhRaw.includes("-")
      ? { start: bhRaw.split("-")[0], end: bhRaw.split("-")[1] }
      : null;

    content = (
      <AtendimentoSettings
        companyId={cId}
        slaMinutes={isNaN(sla) ? 15 : sla}
        outOfHoursMessage={ooh}
        businessHours={bh}
      />
    );
  } else {
    content = <div className="p-6 text-slate-500 text-sm">Seção não encontrada.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SettingsLayout activeSection={secao}>
        {content}
      </SettingsLayout>
    </div>
  );
}

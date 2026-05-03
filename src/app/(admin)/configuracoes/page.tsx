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
import IntegracoesGoogleSection from "./IntegracoesGoogleSection";
import EmailSettings from "./EmailSettings";
import CompanyContacts from "../empresas/[id]/CompanyContacts";
import CompanyVault from "../empresas/[id]/CompanyVault";
import CompanySubscription from "../empresas/[id]/CompanySubscription";

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
  } else if (secao === "empresa" || secao === "minha-empresa-dados") {
    // "empresa" mantido como alias legacy → renderiza dados da minha empresa
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
  } else if (secao === "minha-empresa-contatos" || secao === "minha-empresa-acessos") {
    // Reutiliza CompanyContacts com filtro: contatos (sem acesso) vs acessos (com acesso)
    const mode = secao === "minha-empresa-acessos" ? "access" : "contacts";
    if (!userCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Sua conta não está vinculada a nenhuma empresa.</div>;
    } else {
      const [contactsRaw, allUsers] = await Promise.all([
        prisma.companyContact.findMany({
          where: { companyId: userCompanyId },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ hasAccess: "desc" }, { name: "asc" }],
        }),
        // Users da empresa pra detectar "órfãos" — usuários sem CompanyContact.
        // Um Cosmo duplicado pode existir como User mas não ter linha de contato
        // (caso comum quando criado via convite direto). Sem isso ele some da
        // tela e fica impossível de mesclar.
        prisma.user.findMany({
          where: { companyId: userCompanyId },
          select: { id: true, name: true, email: true },
        }),
      ]);

      const contacts = contactsRaw.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      }));

      // Sintetiza linhas virtuais pra cada User órfão (sem CompanyContact).
      // ID prefixado com "virtual:" pra UI esconder ações destrutivas.
      const linkedUserIds = new Set(contacts.filter((c) => c.user).map((c) => c.user!.id));
      const orphanUsers = allUsers.filter((u) => !linkedUserIds.has(u.id));
      const virtualContacts = orphanUsers.map((u) => ({
        id:        `virtual:${u.id}`,
        name:      u.name,
        phone:     u.email, // sem telefone disponível — usa email como fallback
        isGroup:   false,
        role:      "CONTACT",
        hasAccess: true,    // tem login → entra na aba "Quem tem acesso"
        notes:     null,
        userId:    u.id,
        createdAt: new Date().toISOString(),
        user:      { id: u.id, name: u.name, email: u.email },
      }));

      const merged = [...contacts, ...virtualContacts];

      content = (
        <div className="p-6 max-w-4xl">
          <CompanyContacts companyId={userCompanyId} initialContacts={merged as any} mode={mode} />
        </div>
      );
    }
  } else if (secao === "minha-empresa-cofre") {
    if (!userCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Sua conta não está vinculada a nenhuma empresa.</div>;
    } else {
      content = (
        <div className="p-6 max-w-5xl">
          <CompanyVault companyId={userCompanyId} />
        </div>
      );
    }
  } else if (secao === "minha-empresa-plano") {
    if (!userCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Sua conta não está vinculada a nenhuma empresa.</div>;
    } else {
      // ADMIN visualiza, mas não edita — mudança passa por solicitação ao suporte.
      // SUPER_ADMIN, mesmo nessa rota, fica em modo edição.
      content = (
        <div className="p-2">
          <CompanySubscription companyId={userCompanyId} readOnly={!isSuperAdmin} />
        </div>
      );
    }
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
  } else if (secao === "integracoes-google") {
    // Integrações Google (GA4 + Search Console + GBP) — por empresa
    const companies = isSuperAdmin
      ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [];
    const selectedCompanyId = isSuperAdmin
      ? (qCompanyId ?? "")
      : (userCompanyId ?? "");

    content = (
      <IntegracoesGoogleSection
        isSuperAdmin={isSuperAdmin}
        defaultCompanyId={userCompanyId ?? ""}
        selectedCompanyId={selectedCompanyId}
        companies={companies}
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
  } else if (secao === "email") {
    if (!isSuperAdmin) {
      content = <div className="p-6 text-slate-500 text-sm">Apenas Super Admin pode configurar SMTP.</div>;
    } else {
      content = <EmailSettings />;
    }
  } else if (secao === "atendimento") {
    const cId = userCompanyId ?? "";

    const [settingsRaw, hoursRows] = await Promise.all([
      prisma.setting.findMany({
        where: { key: { in: [`sla_minutes:${cId}`, `out_of_hours_message:${cId}`] } },
      }),
      prisma.businessHoursConfig.findMany({
        where:   { companyId: cId },
        include: { intervals: { orderBy: { startTime: "asc" } } },
        orderBy: { dayOfWeek: "asc" },
      }),
    ]);

    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;
    const sla = parseInt(settings[`sla_minutes:${cId}`] ?? "15", 10);
    const ooh = settings[`out_of_hours_message:${cId}`] ?? "";

    // Constrói o schedule com defaults para dias sem configuração
    const defaultOpen  = [1, 2, 3, 4, 5]; // seg-sex
    const byDay = new Map(hoursRows.map((r) => [r.dayOfWeek, r]));
    const schedule = Array.from({ length: 7 }, (_, d) => {
      const row = byDay.get(d);
      return {
        dayOfWeek: d,
        isOpen:    row ? row.isOpen    : defaultOpen.includes(d),
        openTime:  row ? row.openTime  : "09:00",
        closeTime: row ? row.closeTime : d === 6 ? "13:00" : "18:00",
        intervals: (row?.intervals ?? []).map((iv) => ({
          id:        iv.id,
          startTime: iv.startTime,
          endTime:   iv.endTime,
          label:     iv.label ?? "",
        })),
      };
    });

    content = (
      <AtendimentoSettings
        companyId={cId}
        slaMinutes={isNaN(sla) ? 15 : sla}
        outOfHoursMessage={ooh}
        schedule={schedule}
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

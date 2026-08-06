import { redirect } from "next/navigation";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { getCompanyPlan } from "@/lib/limits";
import SettingsLayout, { type EnabledSections } from "./SettingsLayout";
import SettingsForm from "./SettingsForm";
import InstancesSection from "./InstancesSection";
import PipelineSettings from "./PipelineSettings";
import CustomFieldsSettings from "./CustomFieldsSettings";
import ClickupSettings from "./ClickupSettings";
import OpenAISettings from "./OpenAISettings";
import AssistantsSettings from "./AssistantsSettings";
import ServicesCatalog from "./ServicesCatalog";
import SetoresSection from "./SetoresSection";
import WebhookSettings from "./WebhookSettings";
import AtendimentoSettings from "./AtendimentoSettings";
import GamificacaoSettings from "./GamificacaoSettings";
import { SCORE_TABLE } from "@/lib/gamification";
import { ScoreReason } from "@/generated/prisma";
import IntegracoesGoogleSection from "./IntegracoesGoogleSection";
import EmailSettings from "./EmailSettings";
import MeuPerfilSettings from "./MeuPerfilSettings";
import ProspectaApiSettings from "./ProspectaApiSettings";
import MetaCapiSettings from "./MetaCapiSettings";
import BlingSettings from "./BlingSettings";
import { isBlingConfigured, BLING_REDIRECT_URI } from "@/lib/bling";
import CompanyContacts from "../empresas/[id]/CompanyContacts";
import CompanySubscription from "../empresas/[id]/CompanySubscription";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ secao?: string; companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;
  // Super admin REAL: durante impersonação o role efetivo vira ADMIN, mas só um
  // SUPER_ADMIN consegue impersonar — então isImpersonating prova que o usuário
  // real é Lazzari. Usado pra liberar controles SUPER_ADMIN-only (ex.: cota de IA)
  // mesmo enquanto ele está "Visualizando como cliente".
  const realIsSuperAdmin = isSuperAdmin || isImpersonating(session);

  const sp = await searchParams;
  const secao = sp.secao ?? "instancias";
  const qCompanyId = sp.companyId;

  const webhookBaseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  let content: React.ReactNode;

  if (secao === "meu-perfil") {
    // Sempre o user logado real — `session.user.id` se mantém mesmo durante
    // impersonation (`getEffectiveSession` só altera role/companyId).
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      content = <div className="p-6 text-slate-500 text-sm">Sessão inválida.</div>;
    } else {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, whatsappSignature: true, whatsappSignatureDefault: true },
      });
      if (!me) {
        content = <div className="p-6 text-slate-500 text-sm">Usuário não encontrado.</div>;
      } else {
        content = <MeuPerfilSettings initialUser={me} />;
      }
    }
  } else if (secao === "instancias") {
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
      const [contactsRaw, allUsers, leadsForPhones] = await Promise.all([
        prisma.companyContact.findMany({
          where: { companyId: userCompanyId },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: [{ hasAccess: "desc" }, { name: "asc" }],
        }),
        // Users da empresa pra detectar "órfãos" — usuários sem CompanyContact.
        // Um Cosmo duplicado pode existir como User mas não ter linha de contato
        // (caso comum quando criado via convite direto). Sem isso ele some da
        // tela e fica impossível de mesclar.
        prisma.user.findMany({
          where: { companyId: userCompanyId },
          select: { id: true, name: true, email: true, role: true },
        }),
        // Pipeline lookup: pega Leads existentes pra esses telefones e mapeia
        // pra "Prospect / Lead / Oportunidade". Default = "Cliente" (sem lead).
        prisma.lead.findMany({
          where: { companyId: userCompanyId },
          select: { phone: true, pipeline: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      // Indexa Leads por telefone normalizado (só dígitos). Pega o mais recente.
      const PIPELINE_RANK: Record<string, number> = { OPORTUNIDADES: 3, LEADS: 2, PROSPECCAO: 1 };
      const pipelineByPhone = new Map<string, string>();
      for (const lead of leadsForPhones) {
        const key = (lead.phone ?? "").replace(/\D/g, "");
        if (!key || !lead.pipeline) continue;
        const current = pipelineByPhone.get(key);
        if (!current || (PIPELINE_RANK[lead.pipeline] ?? 0) > (PIPELINE_RANK[current] ?? 0)) {
          pipelineByPhone.set(key, lead.pipeline);
        }
      }

      const contacts = contactsRaw.map((c) => {
        const key = c.phone.replace(/\D/g, "");
        const pipeline = pipelineByPhone.get(key) ?? null;
        return {
          ...c,
          createdAt: c.createdAt.toISOString(),
          pipeline,
        };
      });

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
        user:      { id: u.id, name: u.name, email: u.email, role: u.role },
      }));

      const merged = [...contacts, ...virtualContacts];

      content = (
        <div className="p-6 max-w-4xl">
          <CompanyContacts companyId={userCompanyId} initialContacts={merged as any} mode={mode} />
        </div>
      );
    }
  } else if (secao === "minha-empresa-cofre") {
    // Cofre virou item de topo (/cofre). Redireciona pra preservar bookmarks antigos.
    redirect("/cofre");
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
    const cId = userCompanyId ?? "";

    // ClickUp é per-empresa: precisa de companyId E do módulo ativo na empresa.
    // SUPER_ADMIN sem empresa vinculada vê uma mensagem orientando a abrir
    // a config dentro de uma empresa específica.
    let moduleEnabled = false;
    if (cId) {
      const company = await prisma.company.findUnique({
        where: { id: cId },
        select: { moduleClickup: true } as any,
      });
      moduleEnabled = !!(company && (company as any).moduleClickup);
    }

    if (!cId) {
      content = (
        <div className="p-6 max-w-2xl">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
            ⚠️ ClickUp é configurado por empresa. Acesse este painel impersonando uma empresa-cliente, ou abra <strong>Empresas → [empresa] → Editar</strong> e ative o módulo "ClickUp (integração)" antes de configurar.
          </div>
        </div>
      );
    } else if (!moduleEnabled) {
      content = (
        <div className="p-6 max-w-2xl">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
            ⚠️ Módulo ClickUp desativado para esta empresa. Peça ao super admin para habilitar em <strong>Empresas → editar empresa → módulos</strong>.
          </div>
        </div>
      );
    } else {
      const keys = [
        `clickup_api_token:${cId}`,
        `clickup_webhook_secret:${cId}`,
        `clickup_oportunidades_list_id:${cId}`,
        `clickup_tickets_list_id:${cId}`,
        `clickup_status_ganho:${cId}`,
        `clickup_status_perdido:${cId}`,
        `clickup_status_chamado_concluido:${cId}`,
      ];
      const settingsRaw = await prisma.setting.findMany({ where: { key: { in: keys } } });
      const map: Record<string, string> = {};
      for (const s of settingsRaw) map[s.key] = s.value;

      content = (
        <ClickupSettings
          companyId={cId}
          apiToken={map[`clickup_api_token:${cId}`] ?? ""}
          webhookSecret={map[`clickup_webhook_secret:${cId}`] ?? ""}
          opListId={map[`clickup_oportunidades_list_id:${cId}`] ?? ""}
          ticketListId={map[`clickup_tickets_list_id:${cId}`] ?? ""}
          statusGanho={map[`clickup_status_ganho:${cId}`] ?? "ganho"}
          statusPerdido={map[`clickup_status_perdido:${cId}`] ?? "perdido"}
          statusChamadoConcluido={map[`clickup_status_chamado_concluido:${cId}`] ?? ""}
        />
      );
    }
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
  } else if (secao === "integracoes-prospeccao") {
    // Empresa-alvo: SUPER_ADMIN pode passar ?companyId=, fallback pra sessão.
    const targetCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    if (!targetCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Selecione uma empresa.</div>;
    } else {
      const company = await prisma.company.findUnique({
        where: { id: targetCompanyId },
        select: { moduleProspeccao: true, serpapiKey: true },
      });
      if (!company?.moduleProspeccao && !isSuperAdmin) {
        content = <div className="p-6 text-slate-500 text-sm">Módulo Prospecção não habilitado pra esta empresa. Solicite ao administrador da plataforma.</div>;
      } else {
        content = <ProspectaApiSettings companyId={targetCompanyId} initialKey={company?.serpapiKey ?? ""} />;
      }
    }
  } else if (secao === "integracoes-openai") {
    const settingsRaw = await prisma.setting.findMany({
      where: { key: { in: ["openai_api_key", "openai_model"] } },
    });
    const settings: Record<string, string> = {};
    for (const s of settingsRaw) settings[s.key] = s.value;

    content = <OpenAISettings settings={settings} />;
  } else if (secao === "integracoes-meta") {
    // Meta Conversions API (CAPI) — config por empresa (Pixel + token cifrado).
    const targetCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    if (!targetCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Selecione uma empresa.</div>;
    } else {
      const [cfg, logs] = await Promise.all([
        prisma.metaConversionConfig.findUnique({
          where: { companyId: targetCompanyId },
          select: {
            pixelId: true, testEventCode: true, eventName: true, currency: true,
            enabled: true, lastEventAt: true, lastStatus: true,
          },
        }),
        prisma.metaConversionLog.findMany({
          where: { companyId: targetCompanyId },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: {
            id: true, eventName: true, status: true, attempts: true, value: true,
            matchQuality: true, lastError: true, createdAt: true, leadId: true,
          },
        }),
      ]);
      content = (
        <MetaCapiSettings
          companyId={targetCompanyId}
          isSuperAdmin={isSuperAdmin}
          initialConfig={
            cfg
              ? { ...cfg, lastEventAt: cfg.lastEventAt ? cfg.lastEventAt.toISOString() : null, hasToken: true }
              : null
          }
          logs={logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
        />
      );
    }
  } else if (secao === "integracoes-bling") {
    // Bling (ERP) — só a AZZ conecta. SUPER_ADMIN escolhe a empresa num seletor
    // (mesmo padrão da integração Google); ADMIN usa a própria empresa.
    const targetCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    const companies = isSuperAdmin
      ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [];

    const integ = targetCompanyId
      ? await prisma.blingIntegration.findUnique({
          where: { companyId: targetCompanyId },
          select: {
            status: true, lastSyncAt: true, lastSyncStatus: true, lastError: true,
            lastClientsSynced: true, lastInvoicesSynced: true,
          },
        })
      : null;

    const spAny = sp as any;
    const flash = spAny.bling_success
      ? { ok: true }
      : spAny.bling_error
      ? { error: String(spAny.bling_error) }
      : null;

    content = (
      <BlingSettings
        companyId={targetCompanyId ?? ""}
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        configured={isBlingConfigured()}
        redirectUri={BLING_REDIRECT_URI}
        status={integ?.status ?? null}
        lastSyncAt={integ?.lastSyncAt?.toISOString() ?? null}
        lastSyncStatus={integ?.lastSyncStatus ?? null}
        lastError={integ?.lastError ?? null}
        lastClientsSynced={integ?.lastClientsSynced ?? 0}
        lastInvoicesSynced={integ?.lastInvoicesSynced ?? 0}
        flash={flash}
      />
    );
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
  } else if (secao === "assistentes") {
    // Empresa-alvo: SUPER_ADMIN pode passar ?companyId=, fallback pra sessão.
    const targetCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    if (!targetCompanyId) {
      content = (
        <div className="p-6 text-slate-500 text-sm">
          Assistentes de IA são configurados por empresa. Impersone uma empresa-cliente ou passe ?companyId=.
        </div>
      );
    } else {
      const [assistants, instances, company, setores] = await Promise.all([
        prisma.assistant.findMany({
          where: { companyId: targetCompanyId },
          orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
          include: {
            instance: { select: { id: true, label: true, instanceName: true, phone: true } },
            routes: { include: { setor: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
          },
        }),
        prisma.whatsappInstance.findMany({
          where: { companyId: targetCompanyId },
          select: { id: true, label: true, instanceName: true, phone: true, status: true },
          orderBy: { instanceName: "asc" },
        }),
        prisma.company.findUnique({
          where: { id: targetCompanyId },
          select: { aiMonthlyQuota: true, aiUsedThisMonth: true, aiQuotaResetAt: true },
        }),
        prisma.setor.findMany({
          where: { companyId: targetCompanyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);

      // Usuários com Google Calendar conectado — candidatos a "agenda do agente"
      // (agendamento direto). Inclui SUPER_ADMINs (agência atende pela própria agenda).
      const calendarUsersRaw = await prisma.user.findMany({
        where: {
          googleConnections: { some: { service: "calendar", status: "ACTIVE" } },
          OR: [{ companyId: targetCompanyId }, { role: "SUPER_ADMIN" }],
        },
        select: {
          id: true, name: true,
          googleConnections: {
            where: { service: "calendar", status: "ACTIVE" },
            select: { googleEmail: true, scopes: true },
          },
        },
        orderBy: { name: "asc" },
      });
      const calendarUsers = calendarUsersRaw.map((u) => ({
        id: u.id,
        name: u.name,
        googleEmail: u.googleConnections[0]?.googleEmail ?? null,
        canWrite: (u.googleConnections[0]?.scopes ?? []).some(
          (s) => s.includes("auth/calendar.events") || s === "https://www.googleapis.com/auth/calendar"
        ),
      }));

      content = (
        <div className="space-y-8 pb-6">
          <AssistantsSettings
            companyId={targetCompanyId}
            isSuperAdmin={realIsSuperAdmin}
            initialAssistants={assistants.map((a) => ({
              ...a,
              createdAt: a.createdAt.toISOString(),
              updatedAt: a.updatedAt.toISOString(),
            })) as any}
            instances={instances as any}
            setores={setores}
            calendarUsers={calendarUsers}
            quota={{
              aiMonthlyQuota:  company?.aiMonthlyQuota ?? 0,
              aiUsedThisMonth: company?.aiUsedThisMonth ?? 0,
              aiQuotaResetAt:  company?.aiQuotaResetAt?.toISOString() ?? null,
            }}
          />
        </div>
      );
    }
  } else if (secao === "catalogo") {
    // Catálogo de Serviços — fonte única (usado pela IA e pela área do cliente).
    const targetCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    if (!targetCompanyId) {
      content = <div className="p-6 text-slate-500 text-sm">Catálogo por empresa. Impersone uma empresa ou passe ?companyId=.</div>;
    } else {
      const servicesRaw = await prisma.service.findMany({
        where: { companyId: targetCompanyId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      });
      content = (
        <div className="p-6 max-w-3xl">
          <ServicesCatalog companyId={targetCompanyId} initialServices={servicesRaw as any} />
        </div>
      );
    }
  } else if (secao === "custom-fields") {
    let customCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
    if (!customCompanyId) {
      const firstCompany = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      customCompanyId = firstCompany?.id;
    }
    const allCompaniesForCustom = isSuperAdmin
      ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [];
    content = (
      <CustomFieldsSettings
        isSuperAdmin={isSuperAdmin}
        defaultCompanyId={customCompanyId ?? ""}
        allCompanies={allCompaniesForCustom}
      />
    );
  } else if (secao === "setores") {
    const companyId = userCompanyId ?? "";
    const [setores, allUsers, allInstances, allEmailAccounts] = await Promise.all([
      prisma.setor.findMany({
        where: { companyId },
        include: {
          users:     { include: { user: { select: { id: true, name: true, email: true } } } },
          instances: { include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } } } },
          emailAccounts: { select: { accountId: true } },
          _count:    { select: { tickets: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        // ADMIN também pode pertencer a setor (aparece em rankings, recebe
        // atribuição de chamados/conversas do setor). Antes filtrava só CLIENT
        // e ADMIN sumia da lista de usuários disponíveis na edição do setor.
        where: { companyId, role: { in: ["CLIENT", "ADMIN"] } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      prisma.whatsappInstance.findMany({
        where: { companyId },
        select: { id: true, instanceName: true, phone: true, status: true },
        orderBy: { instanceName: "asc" },
      }),
      prisma.emailAccount.findMany({
        where: { companyId },
        select: { id: true, label: true, fromEmail: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    content = (
      <SetoresSection
        initialSetores={setores as any}
        allUsers={allUsers}
        allInstances={allInstances as any}
        allEmailAccounts={allEmailAccounts as any}
      />
    );
  } else if (secao === "email") {
    if (isSuperAdmin) {
      // SUPER_ADMIN edita o SMTP GLOBAL do sistema (usado pra 2FA do cofre,
      // convite de portal etc.). ADMIN da empresa configura o SMTP PRÓPRIO
      // em E-mail Marketing — esta seção fica escondida do menu pra ele.
      content = <EmailSettings />;
    } else {
      // ADMIN entrou via URL direta — redireciona pra onde a coisa mora.
      redirect("/campanhas/email");
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
  } else if (secao === "gamificacao") {
    const cId = userCompanyId ?? "";
    const ALL_REASONS: ScoreReason[] = [
      "RESPOSTA_RAPIDA_5MIN", "RESPOSTA_RAPIDA_30MIN",
      "TICKET_RESOLVIDO", "LEAD_AVANCADO", "LEAD_CONVERTIDO",
      "DIA_SEM_PENDENCIA", "DIA_SEM_ATRASO", "RETORNO_ANTECIPADO",
      "ATENDIMENTO_MESMO_DIA", "NOTA_REGISTRADA", "PRIMEIRO_CONTATO",
      "PROJETO_ENTREGUE", "PROJETO_ENTREGUE_NO_PRAZO",
      "TAREFA_CRIADA", "TAREFA_ATUALIZADA", "TAREFA_CONCLUIDA",
      "SLA_VENCIDO", "CONVERSA_SEM_RESPOSTA", "PRAZO_PRORROGADO",
      "PROJETO_ATRASADO", "TAREFA_SEM_PRAZO", "TAREFA_ATRASADA",
    ];
    const [configs, users] = cId ? await Promise.all([
      prisma.scoreRuleConfig.findMany({ where: { companyId: cId } }),
      prisma.user.findMany({
        where:  { companyId: cId },
        select: { id: true, name: true, email: true, role: true, rankingCategory: true },
        orderBy: [{ rankingCategory: "asc" }, { name: "asc" }],
      }),
    ]) : [[], []];
    const byReason = new Map(configs.map((c) => [c.reason, c]));
    const initialRules = ALL_REASONS.map((reason) => {
      const cfg = byReason.get(reason);
      return {
        reason,
        defaultPoints:  SCORE_TABLE[reason],
        enabled:        cfg?.enabled        ?? true,
        points:         cfg?.points         ?? SCORE_TABLE[reason],
        affectsRanking: cfg?.affectsRanking ?? true,
      };
    });
    content = <GamificacaoSettings initialRules={initialRules} users={users} />;
  } else {
    content = <div className="p-6 text-slate-500 text-sm">Seção não encontrada.</div>;
  }

  // Visibilidade do menu lateral: gateia seções por módulo da empresa.
  // SUPER_ADMIN sempre vê tudo (pra configurar de qualquer empresa).
  const layoutCompanyId = isSuperAdmin ? (qCompanyId ?? userCompanyId) : userCompanyId;
  let enabledSections: EnabledSections = {
    whatsapp:   true, crm: true, tickets: true, ai: true,
    clickup:    true, gamificacao: true, projetos: true,
    prospeccao: true, marketing: true, bling: true,
  };
  if (!isSuperAdmin && layoutCompanyId) {
    const [company, ctx] = await Promise.all([
      prisma.company.findUnique({
        where: { id: layoutCompanyId },
        select: {
          moduleWhatsapp: true, moduleCrm: true, moduleTickets: true,
          moduleAI: true, moduleClickup: true, moduleGamificacao: true,
          moduleProjetos: true, moduleProspeccao: true, moduleBling: true,
        },
      }),
      // Features que vivem em PlanFeatures (sem flag em Company): marketing.
      // Cofre virou rota top-level /cofre — gateamento feito lá.
      getCompanyPlan(layoutCompanyId).catch(() => null),
    ]);
    enabledSections = {
      whatsapp:    !!company?.moduleWhatsapp,
      crm:         !!company?.moduleCrm,
      tickets:     !!company?.moduleTickets,
      ai:          !!(company as any)?.moduleAI,
      clickup:     !!(company as any)?.moduleClickup,
      gamificacao: !!(company as any)?.moduleGamificacao,
      projetos:    !!(company as any)?.moduleProjetos,
      prospeccao:  !!(company as any)?.moduleProspeccao,
      marketing:   !!ctx?.effectiveFeatures.marketingDashboard,
      bling:       !!(company as any)?.moduleBling,
    };
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SettingsLayout activeSection={secao} enabledSections={enabledSections} isSuperAdmin={isSuperAdmin}>
        {content}
      </SettingsLayout>
    </div>
  );
}

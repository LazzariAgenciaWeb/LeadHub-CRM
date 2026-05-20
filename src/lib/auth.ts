import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { getCompanyPlan } from "./limits";

// Quando o usuário está em múltiplos setores, fazemos UNIÃO (OR) das
// permissões — basta um setor liberar para o usuário ter a permissão.
// Antes pegávamos só o primeiro setor (take: 1) e o usuário ficava com
// menos acesso do que deveria quando o "primeiro" do Prisma era o setor
// mais restrito.
type SetorPerms = {
  canManageUsers:     boolean;
  canViewLeads:       boolean;
  canCreateLeads:     boolean;
  canViewTickets:     boolean;
  canCreateTickets:   boolean;
  canViewConfig:      boolean;
  canUseAI:           boolean;
  canViewInbox:       boolean;
  canSendMessages:    boolean;
  canViewCompanies:   boolean;
  canCreateCompanies: boolean;
};

function mergeSetorPermissions(setores: any[]): SetorPerms | null {
  if (!setores.length) return null;
  const merged: SetorPerms = {
    canManageUsers:     false,
    canViewLeads:       false,
    canCreateLeads:     false,
    canViewTickets:     false,
    canCreateTickets:   false,
    canViewConfig:      false,
    canUseAI:           false,
    canViewInbox:       false,
    canSendMessages:    false,
    canViewCompanies:   false,
    canCreateCompanies: false,
  };
  for (const s of setores) {
    merged.canManageUsers     ||= !!s.canManageUsers;
    merged.canViewLeads       ||= !!s.canViewLeads;
    merged.canCreateLeads     ||= !!s.canCreateLeads;
    merged.canViewTickets     ||= !!s.canViewTickets;
    merged.canCreateTickets   ||= !!s.canCreateTickets;
    merged.canViewConfig      ||= !!s.canViewConfig;
    merged.canUseAI           ||= !!s.canUseAI;
    merged.canViewInbox       ||= !!(s.canViewInbox ?? true);
    merged.canSendMessages    ||= !!(s.canSendMessages ?? true);
    merged.canViewCompanies   ||= !!s.canViewCompanies;
    merged.canCreateCompanies ||= !!s.canCreateCompanies;
  }
  return merged;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: {
            company: {
              select: {
                moduleAI: true,
                moduleCrm: true,
                moduleWhatsapp: true,
                moduleTickets: true,
                moduleClickup: true,
              },
            },
            setores: {
              include: { setor: true },
            },
          },
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!passwordMatch) return null;

        const allSetores = user.setores.map((s) => s.setor);
        const mergedPerms = mergeSetorPermissions(allSetores);

        // Pipelines do CRM (granularidade): lê do plano + customFeatures.
        // Fallback: leads ON, demais OFF (default seguro).
        let pipelineProspeccao = false;
        let pipelineLeads = true;
        let pipelineOportunidades = false;
        let cofreEnabled = false;
        if (user.companyId) {
          try {
            const ctx = await getCompanyPlan(user.companyId);
            pipelineProspeccao = ctx.effectiveFeatures.crmPipelineProspeccao;
            pipelineLeads = ctx.effectiveFeatures.crmPipelineLeads;
            pipelineOportunidades = ctx.effectiveFeatures.crmPipelineOportunidades;
            cofreEnabled = ctx.effectiveFeatures.cofreCredenciais;
            console.log("[AUTH DEBUG]", {
              email: user.email,
              companyId: user.companyId,
              cofreCredenciais: ctx.effectiveFeatures.cofreCredenciais,
              cofreEnabledResolved: cofreEnabled,
              hasCofreKey: "cofreCredenciais" in ctx.effectiveFeatures,
              effectiveFeaturesKeys: Object.keys(ctx.effectiveFeatures).length,
            });
          } catch (err) {
            console.log("[AUTH DEBUG] getCompanyPlan ERRO", { email: user.email, error: String(err) });
            // mantém defaults caso sem subscription
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: user.companyId ?? undefined,
          setorId: allSetores[0]?.id ?? undefined,
          permissions: mergedPerms,
          modules: {
            ai:          (user.company as any)?.moduleAI ?? false,
            crm:         user.company?.moduleCrm ?? true,
            whatsapp:    user.company?.moduleWhatsapp ?? false,
            tickets:     user.company?.moduleTickets ?? false,
            clickup:     (user.company as any)?.moduleClickup ?? false,
            gamificacao: (user.company as any)?.moduleGamificacao ?? false,
            projetos:    (user.company as any)?.moduleProjetos ?? false,
            calendario:  (user.company as any)?.moduleCalendario ?? false,
            prospeccao:  (user.company as any)?.moduleProspeccao ?? false,
            cofre:       cofreEnabled,
            crmPipelineProspeccao:    pipelineProspeccao,
            crmPipelineLeads:         pipelineLeads,
            crmPipelineOportunidades: pipelineOportunidades,
          },
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.companyId = (user as any).companyId;
        token.setorId = (user as any).setorId;
        token.permissions = (user as any).permissions;
        token.modules = (user as any).modules;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).companyId = token.companyId;
        (session.user as any).setorId = token.setorId;
        (session.user as any).permissions = token.permissions;
        (session.user as any).modules = token.modules;

        // Para usuários CLIENT e ADMIN: sempre busca permissões e módulos frescos
        // do banco. Garante que alterações no plano da empresa (e nos módulos
        // sincronizados) reflitam na próxima requisição, sem logout/login.
        // SUPER_ADMIN é skip — modules sempre vem do ALL_MODULES (bypass).
        const role = token.role as string;
        if ((role === "CLIENT" || role === "ADMIN") && token.sub) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: token.sub as string },
              select: {
                companyId: true,
                company: {
                  select: {
                    moduleAI: true,
                    moduleCrm: true,
                    moduleWhatsapp: true,
                    moduleTickets: true,
                    moduleClickup: true,
                    moduleGamificacao: true,
                    moduleProjetos: true,
                    moduleCalendario: true,
                    moduleProspeccao: true,
                  },
                },
                setores: {
                  include: { setor: true },
                },
              },
            });
            if (dbUser) {
              const allSetores = dbUser.setores.map((s) => s.setor);
              (session.user as any).companyId = dbUser.companyId ?? (token.companyId as string | undefined);
              (session.user as any).permissions = mergeSetorPermissions(allSetores);

              // Pipelines do CRM via getCompanyPlan (plan + customFeatures).
              let pipelineProspeccao = false;
              let pipelineLeads = true;
              let pipelineOportunidades = false;
              if (dbUser.companyId) {
                try {
                  const ctx = await getCompanyPlan(dbUser.companyId);
                  pipelineProspeccao = ctx.effectiveFeatures.crmPipelineProspeccao;
                  pipelineLeads = ctx.effectiveFeatures.crmPipelineLeads;
                  pipelineOportunidades = ctx.effectiveFeatures.crmPipelineOportunidades;
                } catch {
                  // mantém defaults
                }
              }

              (session.user as any).modules = {
                ai:          (dbUser.company as any)?.moduleAI          ?? false,
                crm:         dbUser.company?.moduleCrm                  ?? true,
                whatsapp:    dbUser.company?.moduleWhatsapp             ?? false,
                tickets:     dbUser.company?.moduleTickets              ?? false,
                clickup:     (dbUser.company as any)?.moduleClickup     ?? false,
                gamificacao: (dbUser.company as any)?.moduleGamificacao ?? false,
                projetos:    (dbUser.company as any)?.moduleProjetos    ?? false,
                calendario:  (dbUser.company as any)?.moduleCalendario  ?? false,
                prospeccao:  (dbUser.company as any)?.moduleProspeccao  ?? false,
                crmPipelineProspeccao:    pipelineProspeccao,
                crmPipelineLeads:         pipelineLeads,
                crmPipelineOportunidades: pipelineOportunidades,
              };
            }
          } catch (err) {
            // Fallback gracioso: mantém os valores do JWT caso o banco falhe
            console.warn("[Auth] Erro ao atualizar permissões/módulos via DB:", err);
          }
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "leadhub-secret-fallback-troque-em-producao",
};

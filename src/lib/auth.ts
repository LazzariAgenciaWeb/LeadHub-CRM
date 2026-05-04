import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

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

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: user.companyId ?? undefined,
          setorId: allSetores[0]?.id ?? undefined,
          permissions: mergedPerms,
          modules: {
            ai:       (user.company as any)?.moduleAI ?? false,
            crm:      user.company?.moduleCrm ?? true,
            whatsapp: user.company?.moduleWhatsapp ?? false,
            tickets:  user.company?.moduleTickets ?? false,
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

        // Para usuários CLIENT: sempre busca permissões e módulos frescos do banco.
        // Isso garante que alterações no Setor ou nos módulos da empresa reflitam
        // imediatamente, sem exigir logout/login do usuário.
        if ((token.role as string) === "CLIENT" && token.sub) {
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
              (session.user as any).modules = {
                ai:       (dbUser.company as any)?.moduleAI       ?? false,
                crm:      dbUser.company?.moduleCrm   ?? true,
                whatsapp: dbUser.company?.moduleWhatsapp ?? false,
                tickets:  dbUser.company?.moduleTickets  ?? false,
              };
            }
          } catch (err) {
            // Fallback gracioso: mantém os valores do JWT caso o banco falhe
            console.warn("[Auth] Erro ao atualizar permissões do CLIENT via DB:", err);
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

import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

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
              take: 1,
            },
          },
        });

        if (!user) return null;

        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!passwordMatch) return null;

        const primarySetor = user.setores[0]?.setor ?? null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyId: user.companyId ?? undefined,
          setorId: primarySetor?.id ?? undefined,
          permissions: primarySetor ? {
            canManageUsers:     primarySetor.canManageUsers,
            canViewLeads:       primarySetor.canViewLeads,
            canCreateLeads:     primarySetor.canCreateLeads,
            canViewTickets:     primarySetor.canViewTickets,
            canCreateTickets:   primarySetor.canCreateTickets,
            canViewConfig:      primarySetor.canViewConfig,
            canUseAI:           (primarySetor as any).canUseAI ?? false,
            canViewInbox:       (primarySetor as any).canViewInbox ?? true,
            canSendMessages:    (primarySetor as any).canSendMessages ?? true,
            canViewCompanies:   (primarySetor as any).canViewCompanies ?? false,
            canCreateCompanies: (primarySetor as any).canCreateCompanies ?? false,
          } : null,
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
                  take: 1,
                },
              },
            });
            if (dbUser) {
              const setor = dbUser.setores[0]?.setor;
              (session.user as any).companyId = dbUser.companyId ?? (token.companyId as string | undefined);
              (session.user as any).permissions = setor ? {
                canManageUsers:     setor.canManageUsers,
                canViewLeads:       setor.canViewLeads,
                canCreateLeads:     setor.canCreateLeads,
                canViewTickets:     setor.canViewTickets,
                canCreateTickets:   setor.canCreateTickets,
                canViewConfig:      setor.canViewConfig,
                canUseAI:           (setor as any).canUseAI           ?? false,
                canViewInbox:       (setor as any).canViewInbox        ?? true,
                canSendMessages:    (setor as any).canSendMessages     ?? true,
                canViewCompanies:   (setor as any).canViewCompanies    ?? false,
                canCreateCompanies: (setor as any).canCreateCompanies  ?? false,
              } : null;
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

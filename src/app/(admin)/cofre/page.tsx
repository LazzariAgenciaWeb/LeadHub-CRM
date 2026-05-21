import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { getCompanyPlan } from "@/lib/limits";
import CompanyVault from "../empresas/[id]/CompanyVault";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CofrePage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session.user as any).role as string;
  const companyId = (session.user as any).companyId as string | undefined;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = isSuperAdmin || role === "ADMIN";
  const canViewCofre = !!(session.user as any).permissions?.canViewCofre;

  // Defesa em profundidade: CLIENT só vê /cofre se o setor liberou canViewCofre.
  // Sidebar já esconde o item, mas URL digitada manualmente cai aqui.
  if (!isAdmin && !canViewCofre) {
    return (
      <div className="p-6">
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
          <p className="text-slate-300 text-sm font-semibold mb-1">Acesso negado</p>
          <p className="text-slate-500 text-xs">
            Seu setor não tem permissão para acessar o Cofre. Fale com o admin da empresa.
          </p>
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
          <p className="text-slate-500 text-sm">
            Sua conta não está vinculada a nenhuma empresa.
          </p>
        </div>
      </div>
    );
  }

  // Gate por PlanFeatures.cofreCredenciais (SUPER_ADMIN bypassa).
  if (!isSuperAdmin) {
    try {
      const ctx = await getCompanyPlan(companyId);
      if (!ctx.effectiveFeatures.cofreCredenciais) {
        return (
          <div className="p-6">
            <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
              <p className="text-slate-300 text-sm font-semibold mb-1">Cofre não disponível no seu plano</p>
              <p className="text-slate-500 text-xs">
                Faça upgrade do seu plano para gerenciar credenciais sensíveis da empresa.
              </p>
            </div>
          </div>
        );
      }
    } catch {
      // Sem subscription → bloqueia.
      return (
        <div className="p-6">
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-8 text-center">
            <p className="text-slate-500 text-sm">Cofre indisponível.</p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <CompanyVault companyId={companyId} />
    </div>
  );
}

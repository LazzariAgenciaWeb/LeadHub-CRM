import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import InstagramManager from "./InstagramManager";
import SuperAdminCompanyGate from "@/components/SuperAdminCompanyGate";

export const metadata = { title: "Instagram · LeadHub" };

export default async function InstagramPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  if ((session.user as any)?.role === "SUPER_ADMIN") return <SuperAdminCompanyGate title="Instagram" />;

  const gate = await assertModule(session, "instagram");
  if (!gate.ok) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white mb-2">Instagram</h1>
        <p className="text-slate-400 text-sm">Módulo não disponível para esta empresa.</p>
      </div>
    );
  }

  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-white mb-2">Instagram</h1>
        <p className="text-slate-400 text-sm">
          Sem empresa no contexto. Logue como admin da empresa ou use &quot;Visualizar como cliente&quot;
          a partir de Empresas.
        </p>
      </div>
    );
  }

  return <InstagramManager />;
}

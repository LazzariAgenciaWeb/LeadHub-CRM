import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import IgInbox from "./IgInbox";
import SuperAdminCompanyGate from "@/components/SuperAdminCompanyGate";

export const metadata = { title: "Inbox Instagram · LeadHub" };

export default async function IgInboxPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  if ((session.user as any)?.role === "SUPER_ADMIN") return <SuperAdminCompanyGate title="Inbox Social" />;

  const gate = await assertModule(session, "instagram");
  if (!gate.ok) {
    return <div className="p-6 text-slate-400 text-sm">Módulo não disponível para esta empresa.</div>;
  }
  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) {
    return <div className="p-6 text-slate-400 text-sm">Sem empresa no contexto. Logue como admin da empresa ou use &quot;Visualizar como cliente&quot;.</div>;
  }

  return <IgInbox />;
}

import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { can, isAdmin } from "@/lib/permissions";
import NovaEmpresaForm from "./NovaEmpresaForm";

export default async function NovaEmpresaPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const role = (session?.user as any)?.role;

  // CLIENT sem canCreateCompanies → sem acesso
  if (role === "CLIENT" && !can(session, "canCreateCompanies")) redirect("/empresas");

  const isSuperAdmin = role === "SUPER_ADMIN";
  return <NovaEmpresaForm isSuperAdmin={isSuperAdmin} />;
}

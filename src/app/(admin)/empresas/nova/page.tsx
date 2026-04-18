import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import NovaEmpresaForm from "./NovaEmpresaForm";

export default async function NovaEmpresaPage() {
  const session = await getServerSession(authOptions);
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  return <NovaEmpresaForm isSuperAdmin={isSuperAdmin} />;
}

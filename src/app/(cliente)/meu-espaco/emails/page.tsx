import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import CompanyCpanelEmail from "@/app/(admin)/empresas/[id]/CompanyCpanelEmail";

export const dynamic = "force-dynamic";

// Meu Espaço → E-mails: espaço da hospedagem e caixas de e-mail do cliente.
// Só aparece quando a agência liberou (cadastro do cliente → Marketing →
// Integrações → cPanel → "No Meu Espaço do cliente").
export default async function EmailsPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as { companyId?: string } | undefined)?.companyId;
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true, cpanelIntegration: { select: { clientCanManageEmail: true } } },
  });
  if (!company?.parentCompanyId) redirect("/dashboard");
  if (!company.cpanelIntegration?.clientCanManageEmail) redirect("/meu-espaco");

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/meu-espaco" style={{ fontSize: 13, fontWeight: 600, color: "#727A8C", textDecoration: "none" }}>← Voltar</Link>
      <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: "#F3F5FA" }}>E-mails e hospedagem</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, color: "#AFB6C6" }}>
        Veja o espaço usado no seu site e nas suas caixas de e-mail, e troque senhas quando precisar.
      </p>
      <CompanyCpanelEmail portal />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import CompanyCpanelEmail from "@/app/(admin)/empresas/[id]/CompanyCpanelEmail";
import CompanyCpanelUpload from "@/app/(admin)/empresas/[id]/CompanyCpanelUpload";

export const dynamic = "force-dynamic";

// Meu Espaço → E-mails: espaço da hospedagem e caixas de e-mail do cliente.
// Só aparece quando a agência liberou (cadastro do cliente → Hospedagem →
// "No Meu Espaço do cliente"): e-mails e envio de arquivos são liberações separadas.
export default async function EmailsPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as { companyId?: string } | undefined)?.companyId;
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true, cpanelIntegration: { select: { clientCanManageEmail: true, clientCanUpload: true } } },
  });
  if (!company?.parentCompanyId) redirect("/dashboard");
  const showEmail = !!company.cpanelIntegration?.clientCanManageEmail;
  const showUpload = !!company.cpanelIntegration?.clientCanUpload;
  if (!showEmail && !showUpload) redirect("/meu-espaco");

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/meu-espaco" style={{ fontSize: 13, fontWeight: 600, color: "#727A8C", textDecoration: "none" }}>← Voltar</Link>
      <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: "#F3F5FA" }}>E-mails e hospedagem</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, color: "#AFB6C6" }}>
        {showEmail
          ? "Veja o espaço usado no site e nos e-mails, cuide das suas caixas e abra um chamado se algo der errado."
          : "Envie arquivos para o seu site."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {showEmail && <CompanyCpanelEmail portal />}
        {showUpload && <CompanyCpanelUpload portal />}
      </div>
    </div>
  );
}

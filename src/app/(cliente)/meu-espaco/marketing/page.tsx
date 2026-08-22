import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import CompanyMarketing from "@/app/(admin)/empresas/[id]/CompanyMarketing";

export const dynamic = "force-dynamic";

/**
 * Relatório de Marketing dentro do portal do cliente.
 *
 * Reusa o MESMO componente da agência em `mode="client"`: sem controles de
 * escrita e sem número de custo (investimento, CPC, CPA, ROAS). O bloqueio de
 * escrita também existe no servidor — ver `src/lib/client-portal.ts`; esconder
 * botão não é proteção.
 *
 * Fica atrás do toggle `Company.moduleRelatorioMarketing`, ligado por empresa no
 * editor da empresa (aba Módulos), pra a agência liberar só o cliente que já
 * está com as integrações em ordem.
 */
export default async function ClienteMarketingPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true, moduleRelatorioMarketing: true },
  });
  // Só sub-empresa entra no portal…
  if (!company?.parentCompanyId) redirect("/dashboard");
  // …e só quando a agência liberou o relatório pra ela.
  if (!company.moduleRelatorioMarketing) redirect("/meu-espaco");

  return (
    <div className="mkwrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="mkhead">
        <h1>Marketing</h1>
        <p>Resultados do seu site e das campanhas, atualizados diariamente.</p>
      </header>
      <div className="mkbody">
        <CompanyMarketing companyId={companyId} mode="client" />
      </div>
    </div>
  );
}

// O dashboard foi desenhado pro tema escuro do admin; a casca do portal usa
// outro fundo. Este wrapper devolve o contexto escuro só dentro do relatório.
const CSS = `
.mkwrap{max-width:1200px;margin:0 auto;padding:22px 18px 48px}
.mkhead h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em}
.mkhead p{margin:4px 0 18px;font-size:13px;color:#94a3b8}
.mkbody{background:#070b14;border:1px solid #1e2d45;border-radius:16px;overflow:hidden}
`;

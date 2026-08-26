import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import CompanyMarketing from "@/app/(admin)/empresas/[id]/CompanyMarketing";
import { assertModule } from "@/lib/billing";

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
  // Só sub-empresa entra no portal.
  if (!company?.parentCompanyId) redirect("/dashboard");
  // Antes havia aqui um `redirect("/meu-espaco")` quando
  // `moduleRelatorioMarketing` era false. Esse flag é cache derivado e nenhuma
  // tela o liga (a lista de módulos do editor de empresa é somente leitura),
  // então na prática a página se auto-expulsava — e o cliente via um "voltou
  // pro Meu Espaço" sem explicação. Quem decide agora é o gate de plano abaixo,
  // que explica o motivo em vez de redirecionar em silêncio.

  // O plano da empresa pode não incluir o módulo marketing — nesse caso as APIs
  // do dashboard respondem 403 e a tela mostraria erro cru. Checamos antes e
  // explicamos, em vez de deixar o cliente achar que quebrou.
  const gate = company.moduleRelatorioMarketing
    ? ({ ok: true } as const)
    : await assertModule(session, "marketing");

  return (
    <div className="mkwrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="mkhead">
        <h1>Marketing</h1>
        <p>Resultados do seu site e das campanhas, atualizados diariamente.</p>
      </header>

      {gate.ok ? (
        <div className="mkbody">
          <CompanyMarketing companyId={companyId} mode="client" />
        </div>
      ) : (
        <div className="mkoff">
          <span className="mkoffi">📊</span>
          <h2>Relatório ainda não disponível</h2>
          <p>
            O acompanhamento de marketing não faz parte do seu plano atual. Fale com a
            agência para liberar — assim que ligarem, os dados aparecem aqui sozinhos.
          </p>
        </div>
      )}
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
.mkoff{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;
  padding:44px 28px;text-align:center;max-width:520px;margin:0 auto}
.mkoffi{font-size:34px;display:block;margin-bottom:10px}
.mkoff h2{margin:0 0 8px;font-size:16px;font-weight:700}
.mkoff p{margin:0;font-size:13px;line-height:1.6;color:#94a3b8}
`;

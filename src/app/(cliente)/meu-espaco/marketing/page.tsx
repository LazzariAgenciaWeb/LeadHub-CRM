import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import CompanyMarketing from "@/app/(admin)/empresas/[id]/CompanyMarketing";
import BioPageMarketing from "@/app/(admin)/empresas/[id]/BioPageMarketing";
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
        // Sem o relatório completo no plano: a Página do Negócio (grátis) já
        // aparece, e logo abaixo o que mais dá pra acompanhar aqui — pro
        // cliente enxergar que tem muito além da página.
        <>
          <div className="mkbody mkpad">
            <BioPageMarketing companyId={companyId} days={30} />
          </div>
          <div className="mkmore">
            <h2>Tem muito mais pra acompanhar aqui</h2>
            <p>Com o relatório de marketing ativo, tudo isto aparece neste mesmo lugar, atualizado todo dia:</p>
            <div className="mkgrid">
              {TOOLS.map((g) => (
                <div key={g.title} className="mkcol">
                  <h3>{g.title}</h3>
                  <span className="mksub">{g.sub}</span>
                  <ul>
                    {g.items.map(([name, desc]) => (
                      <li key={name}><b>{name}</b><span>{desc}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mkcta">Fale com a agência para ativar — assim que ligarem, os dados aparecem aqui sozinhos.</p>
          </div>
        </>
      )}
    </div>
  );
}

const TOOLS: { title: string; sub: string; items: [string, string][] }[] = [
  {
    title: "Orgânico",
    sub: "quem te encontra sem você pagar por clique",
    items: [
      ["Site (Google Analytics)", "visitas, de onde vêm e o que viram"],
      ["Buscas no Google (Search Console)", "o que digitam até chegar em você"],
      ["Google Meu Negócio", "aparições no Maps, ligações e avaliações"],
      ["Instagram", "alcance, seguidores e mensagens"],
    ],
  },
  {
    title: "Campanhas pagas",
    sub: "anúncios e o retorno de cada um",
    items: [
      ["Google Ads", "anúncios na busca e no YouTube"],
      ["Meta Ads", "anúncios no Instagram e no Facebook"],
      ["Contatos por campanha", "qual anúncio trouxe cada cliente"],
    ],
  },
];

// O dashboard foi desenhado pro tema escuro do admin; a casca do portal usa
// outro fundo. Este wrapper devolve o contexto escuro só dentro do relatório.
const CSS = `
.mkwrap{max-width:1200px;margin:0 auto;padding:22px 18px 48px}
.mkhead h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em}
.mkhead p{margin:4px 0 18px;font-size:13px;color:#94a3b8}
.mkbody{background:#070b14;border:1px solid #1e2d45;border-radius:16px;overflow:hidden}
.mkpad{padding:16px}
.mkmore{margin-top:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px}
.mkmore h2{margin:0 0 4px;font-size:16px;font-weight:700}
.mkmore>p{margin:0 0 14px;font-size:13px;color:#94a3b8}
.mkgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.mkcol{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px}
.mkcol h3{margin:0;font-size:14px;font-weight:700}
.mksub{display:block;font-size:12px;color:#94a3b8;margin-bottom:8px}
.mkcol ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.mkcol li b{display:block;font-size:13px}
.mkcol li span{font-size:12px;color:#94a3b8}
.mkmore .mkcta{margin:14px 0 0;font-size:12.5px;color:#cbd5e1}
`;

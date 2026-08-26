import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { isClientPortalUser } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import {
  LISTA_CONTRATOS_PADRAO,
  analisarImportacao,
  fetchContratos,
  type RelatorioImportacao,
} from "@/lib/clickup-contratos";
import ImportarClickup, { type RelatorioTela } from "./ImportarClickup";

export const dynamic = "force-dynamic";

/**
 * A prévia é montada AQUI, no servidor, e não por fetch do navegador.
 *
 * A primeira versão pedia o relatório via fetch e desenhava no cliente — e a
 * aba morria antes de mostrar qualquer coisa, mesmo com o servidor de pé
 * (sonda: 0 falhas) e a lista pequena (~100 contratos). Renderizando no
 * servidor, some a requisição do navegador, some o JSON grande e some a
 * classe inteira de erro: se algo falhar, falha como página, com mensagem.
 */
export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<{ previa?: string; lista?: string; encerrados?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  // Gestão interna da agência: empresa-cliente que entra no sistema não abre
  // esta área — esconder no menu não basta, a rota é adivinhável.
  if (await isClientPortalUser(session)) redirect("/meu-espaco");

  const role = (session.user as any)?.role as string;
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  if (!isAdmin && !can(session, "canViewFinanceiro")) redirect("/dashboard");

  const agencyId = (session.user as any)?.companyId as string | undefined;
  const token = agencyId
    ? (await prisma.setting.findUnique({ where: { key: `clickup_api_token:${agencyId}` } }))?.value?.trim()
    : null;

  const sp = await searchParams;
  const listId = (sp.lista ?? "").trim() || LISTA_CONTRATOS_PADRAO;
  const incluirEncerrados = sp.encerrados === "1";

  let relatorio: RelatorioTela | null = null;
  let erro: string | null = null;

  if (sp.previa === "1" && agencyId && token) {
    try {
      const tasks = await fetchContratos(token, listId, incluirEncerrados);
      relatorio = paraTela(await analisarImportacao(agencyId, tasks, incluirEncerrados));
    } catch (e) {
      erro = (e as Error).message;
    }
  }

  return (
    <ImportarClickup
      listaPadrao={listId}
      incluirEncerrados={incluirEncerrados}
      temEmpresa={!!agencyId}
      temToken={!!token}
      relatorio={relatorio}
      erroServidor={erro}
    />
  );
}

/**
 * `notes` embute descritivo, anotações e o texto inteiro da task. A tela não
 * usa nada disso — só cliente, contrato, valor, dia e ciclo. Lista explícita
 * de campos pra que algo novo na lib não passe a trafegar sem querer.
 */
function paraTela(r: RelatorioImportacao): RelatorioTela {
  return {
    totalTasks: r.totalTasks,
    encerradas: r.encerradas,
    contratos: r.contratos,
    mrrCents: r.mrrCents,
    semValor: r.semValor,
    semDia: r.semDia,
    porCategoria: r.porCategoria,
    clientesExistentes: r.clientesExistentes,
    clientesNovos: r.clientesNovos,
    nomesParecidos: r.nomesParecidos,
    servicos: r.servicos,
    // `url` é o site do cliente. Vai pra tela porque é o que identifica de qual
    // domínio é aquela hospedagem — sem ele a linha "hospedagem R$ 65" não diz
    // de quem é.
    itens: r.itens.map((i) => ({
      taskId: i.taskId,
      cliente: i.cliente,
      label: i.label,
      amountCents: i.amountCents,
      billingCycle: i.billingCycle,
      billingDay: i.billingDay,
      url: i.url ?? null,
    })),
  };
}

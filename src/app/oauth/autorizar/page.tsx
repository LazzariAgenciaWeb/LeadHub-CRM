import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userCanUseAssistant } from "@/lib/personal-assistant/access";

/**
 * Tela de consentimento do OAuth do MCP: "O claude.ai quer acessar o seu
 * assistente do GoHub". Usuário logado clica Autorizar → POST /api/oauth/authorize.
 */
export default async function AutorizarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session) {
    const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/autorizar?${qs}`)}`);
  }
  const userId = (session!.user as any).id as string;
  const clientId = sp.client_id ?? "";
  const client = clientId ? await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } }) : null;
  const redirectOk = !!client && !!sp.redirect_uri && client.redirectUris.includes(sp.redirect_uri);
  const allowed = await userCanUseAssistant(userId);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, company: { select: { name: true } } } });

  const hidden = ["client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method", "response_type"] as const;

  return (
    <div className="min-h-screen bg-[#080b12] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-md bg-[#0f1623] border border-[#1e2d45] rounded-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-[#1e2d45] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-pink-500/30 border border-fuchsia-500/40 flex items-center justify-center text-xl">🤖</div>
          <div>
            <h1 className="font-bold">Conectar ao Assistente do GoHub</h1>
            <p className="text-xs text-slate-500">{client?.name ?? "Um aplicativo"} quer acessar o seu assistente pessoal</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!client || !redirectOk ? (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">Pedido de autorização inválido (cliente ou redirect desconhecido). Tente adicionar o conector de novo.</div>
          ) : !allowed ? (
            <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">O assistente pessoal não está liberado para a sua empresa. Fale com o administrador da plataforma.</div>
          ) : (
            <>
              <div className="text-sm text-slate-300">
                Você está logado como <b className="text-white">{me?.name}</b> ({me?.email}){me?.company ? <> · {me.company.name}</> : null}.
              </div>
              <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                <li>Ler sua fila do dia, clientes, projetos e bloquinho</li>
                <li>Criar tarefas, lembretes, chamados, projetos e anotações em seu nome</li>
                <li>Mandar mensagens no seu grupo do WhatsApp do assistente</li>
                <li>Financeiro: lançar cobranças (o Claude confirma com você antes)</li>
              </ul>
              <form method="POST" action="/api/oauth/authorize" className="flex gap-2 pt-2">
                {hidden.map((k) => sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null)}
                <button name="decision" value="allow" className="flex-1 px-4 py-2.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-semibold">Autorizar</button>
                <button name="decision" value="deny" className="px-4 py-2.5 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white text-sm">Cancelar</button>
              </form>
              <p className="text-[11px] text-slate-600">Você pode revogar depois em Configurações → Meu Perfil.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

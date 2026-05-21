import { getEffectiveSession } from "@/lib/effective-session";
import {
  Bot, Shield, Calendar, Search, FolderKanban, Trophy, CheckSquare,
  Sparkles, Lock, type LucideIcon,
} from "lucide-react";

/**
 * Grid de "módulos disponíveis pra contratar".
 *
 * Renderiza no rodapé da Visão Geral pra cada módulo opcional que a empresa
 * NÃO tem ativo (session.user.modules.X = false). Cada card mostra o que o
 * módulo entrega + CTA pra abrir WhatsApp do suporte com mensagem pronta.
 *
 * Esconde a seção inteira quando o cliente já tem tudo (nada a mostrar).
 */

interface ModuleDef {
  key: string;
  name: string;
  Icon: LucideIcon;
  iconColor: string;
  bgGradient: string; // tailwind classes
  description: string;
}

// Apenas módulos OPCIONAIS / add-on. Core (whatsapp, crm, tickets) não entra
// — quem não tem deles está num plano FREE e a tela inteira vira outra coisa.
const OPTIONAL_MODULES: ModuleDef[] = [
  {
    key: "gamificacao",
    name: "Gamificação",
    Icon: Trophy,
    iconColor: "text-amber-400",
    bgGradient: "from-amber-500/10 to-orange-500/5 border-amber-500/30",
    description: "Pontue ações dos atendentes, libere medalhas e veja o ranking ao vivo. Aumenta engajamento e ajuda a achar top performers.",
  },
  {
    key: "ai",
    name: "Assistente IA",
    Icon: Sparkles,
    iconColor: "text-fuchsia-400",
    bgGradient: "from-fuchsia-500/10 to-purple-500/5 border-fuchsia-500/30",
    description: "Resumo automático de conversas, sugestões de resposta, detecção de intenção e classificação de leads — sem precisar ler tudo.",
  },
  {
    key: "calendario",
    name: "Calendário",
    Icon: Calendar,
    iconColor: "text-cyan-400",
    bgGradient: "from-cyan-500/10 to-sky-500/5 border-cyan-500/30",
    description: "Meu Dia com retornos agendados, conversas atrasadas, chamados e follow-ups — tudo o que precisa atenção hoje, num lugar só.",
  },
  {
    key: "projetos",
    name: "Projetos",
    Icon: FolderKanban,
    iconColor: "text-orange-400",
    bgGradient: "from-orange-500/10 to-red-500/5 border-orange-500/30",
    description: "Kanban de projetos pós-venda. Organize entregas por etapa, prazo e responsável sem misturar com chamados de suporte.",
  },
  {
    key: "prospeccao",
    name: "Prospecta IA",
    Icon: Search,
    iconColor: "text-blue-400",
    bgGradient: "from-blue-500/10 to-indigo-500/5 border-blue-500/30",
    description: "Busca leads no Google Maps por nicho/região e importa direto pro CRM com nome, telefone e site validados.",
  },
  {
    key: "clickup",
    name: "ClickUp",
    Icon: CheckSquare,
    iconColor: "text-violet-400",
    bgGradient: "from-violet-500/10 to-fuchsia-500/5 border-violet-500/30",
    description: "Sincronização bidirecional de chamados e oportunidades com o ClickUp. Comentários, status e prazos sempre alinhados.",
  },
  {
    key: "cofre",
    name: "Cofre de Credenciais",
    Icon: Shield,
    iconColor: "text-emerald-400",
    bgGradient: "from-emerald-500/10 to-green-500/5 border-emerald-500/30",
    description: "Guarde senhas e acessos da empresa criptografados com AES-256. 2FA por email pra revelar. Bem mais seguro que planilha.",
  },
  {
    key: "agente-ia",
    name: "Agente IA (atendimento)",
    Icon: Bot,
    iconColor: "text-indigo-400",
    bgGradient: "from-indigo-500/10 to-purple-500/5 border-indigo-500/30",
    description: "Atende clientes no WhatsApp 24/7 com IA treinada no seu negócio. Tira dúvidas, qualifica leads e só passa pra humano quando precisa.",
  },
];

export default async function ModuleUpsell() {
  const session = await getEffectiveSession();
  if (!session) return null;

  const modules = (session.user as any).modules as Record<string, boolean> | undefined;
  const companyId = (session.user as any).companyId as string | undefined;
  if (!companyId) return null;

  // Lista os módulos opcionais que a empresa NÃO tem ativos.
  // "agente-ia" não está nas flags atuais (feature ainda em backlog),
  // então sempre cai como "não tem" — deixamos como teaser.
  const missing = OPTIONAL_MODULES.filter((m) => {
    if (m.key === "agente-ia") return true; // feature futura, sempre teaser
    return !(modules?.[m.key] ?? false);
  });

  if (missing.length === 0) return null;

  const supportPhone = "5544999015088";

  return (
    <div className="bg-[#0f1623]/40 border border-[#1e2d45] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-4 h-4 text-slate-500" strokeWidth={2} />
        <h2 className="text-white font-semibold text-sm">Recursos disponíveis pra ativar</h2>
      </div>
      <p className="text-slate-500 text-xs mb-4">
        Add-ons que não estão no seu plano. Clique em qualquer um pra solicitar via WhatsApp.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {missing.map((m) => {
          const msg = encodeURIComponent(
            `Olá! Gostaria de ativar o módulo de ${m.name} no LeadHub. Empresa ID: ${companyId}`,
          );
          const requestUrl = `https://wa.me/${supportPhone}?text=${msg}`;
          return (
            <a
              key={m.key}
              href={requestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`group relative bg-gradient-to-br ${m.bgGradient} border rounded-xl p-4 hover:scale-[1.02] hover:brightness-110 transition-all`}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <m.Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <h3 className="text-white font-semibold text-[13px]">{m.name}</h3>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-500 font-bold uppercase tracking-wider">
                      Não contratado
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed line-clamp-3">
                    {m.description}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-green-400 group-hover:text-green-300">
                    <Sparkles className="w-3 h-3" />
                    Solicitar contratação →
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

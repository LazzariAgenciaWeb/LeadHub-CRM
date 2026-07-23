import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";

// Copy de upsell por módulo (chaves = os mesmos `module*` gates do Sidebar/hasModule).
// Reaproveita o padrão paywall da Gamificação (blur + "Contratar módulo" via WhatsApp).
export const MODULE_UPSELL: Record<string, { title: string; desc: string; emoji: string }> = {
  whatsapp:                { title: "WhatsApp",       emoji: "💬", desc: "Central de atendimento com caixa de entrada, templates e histórico de conversas num painel só." },
  instagram:               { title: "Instagram",      emoji: "📸", desc: "Automatize respostas de comentário e DM (estilo ManyChat) e transforme interações em leads." },
  ai:                      { title: "Assistente IA",  emoji: "✨", desc: "Chat com IA e resumos automáticos das conversas pra ganhar tempo no atendimento." },
  tickets:                 { title: "Chamados",       emoji: "🎫", desc: "Abra, organize e acompanhe chamados dos seus clientes com status e histórico." },
  crm:                     { title: "CRM",            emoji: "🧭", desc: "Pipelines de prospecção, leads e oportunidades pra organizar todo o seu funil de vendas." },
  crmPipelineProspeccao:   { title: "Prospecção",     emoji: "🔎", desc: "Pipeline de busca ativa pra encontrar e qualificar novos prospects." },
  crmPipelineLeads:        { title: "Leads",          emoji: "🎯", desc: "Pipeline de leads pra organizar e qualificar novos contatos." },
  crmPipelineOportunidades:{ title: "Oportunidades",  emoji: "💡", desc: "Pipeline de oportunidades pra acompanhar negociações até o fechamento." },
  campanhas:               { title: "Campanhas",      emoji: "📣", desc: "Crie e gerencie campanhas, vincule leads e acompanhe resultados por UTM." },
  links:                   { title: "Links de rastreio", emoji: "🔗", desc: "Gere links com pixel e acompanhe cada clique e conversão." },
  videos:                  { title: "Vídeos",         emoji: "🎬", desc: "Biblioteca de vídeos de apoio estilo Netflix pra entregar conteúdo aos seus clientes." },
  gamificacao:             { title: "Gamificação",    emoji: "🏆", desc: "Pontue cada ação da equipe, libere medalhas por desempenho e veja o ranking ao vivo." },
  projetos:                { title: "Projetos",       emoji: "🗂️", desc: "Gestão de projetos com etapas, status e cobrança pros seus clientes." },
  calendario:              { title: "Calendário",     emoji: "📅", desc: "Agenda com visão Dia/Semana/Mês e integração com o Google Calendar." },
  cofre:                   { title: "Cofre de credenciais", emoji: "🔐", desc: "Guarde senhas criptografadas com 2FA por e-mail e auditoria de acesso." },
};

const SUPPORT_PHONE = "5544999015088";

export default function FeatureLocked({ module, companyId }: { module: string; companyId?: string }) {
  const info = MODULE_UPSELL[module] ?? {
    title: "Recurso",
    emoji: "🔒",
    desc: "Este recurso não está incluído no seu plano atual.",
  };
  const msg = encodeURIComponent(
    `Olá! Gostaria de ativar o módulo "${info.title}" no LeadHub.${companyId ? ` Empresa ID: ${companyId}` : ""}`,
  );
  const requestUrl = `https://wa.me/${SUPPORT_PHONE}?text=${msg}`;

  return (
    <div className="p-6">
      <div className="max-w-md mx-auto mt-8 bg-[#0a0f1a]/85 border border-amber-500/30 rounded-2xl px-6 py-8 text-center shadow-2xl shadow-amber-500/10">
        <div className="text-4xl mb-3" aria-hidden="true">{info.emoji}</div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-amber-400" strokeWidth={2.5} />
          <span className="text-[11px] uppercase tracking-wider font-bold text-amber-400">
            Não disponível no seu plano
          </span>
        </div>
        <h2 className="text-white font-bold text-xl mb-1.5">{info.title}</h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-5">{info.desc}</p>
        <a
          href={requestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-[#0a0f1a] font-bold text-sm transition-all shadow-lg shadow-amber-500/30"
        >
          <Sparkles className="w-4 h-4" />
          Contratar
        </a>
        <div className="mt-4">
          <Link href="/dashboard" className="text-slate-500 text-xs hover:text-slate-300 transition-colors">
            ← Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

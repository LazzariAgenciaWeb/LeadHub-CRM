/**
 * Definições de gradientes SVG para uso com ícones Lucide.
 *
 * Como funciona:
 *  - Esse componente é renderizado UMA vez no layout (montar perto do <body>).
 *  - Cada gradiente vira um <linearGradient id="grad-X"> que pode ser
 *    referenciado por qualquer SVG em qualquer parte do app.
 *  - Para usar em um ícone Lucide:
 *      <MessageSquare stroke="url(#grad-whatsapp)" />
 *
 * Cada chave de GRADIENTS é um tema visual (whatsapp, crm, marketing…).
 * Ajustar paleta aqui propaga pra todos os usos automaticamente.
 */

export const GRADIENTS = {
  // Início → Fim (de canto superior-esquerdo pra inferior-direito)
  dashboard:    ["#6366f1", "#8b5cf6"],   // indigo → violet (geral)
  whatsapp:     ["#22c55e", "#06b6d4"],   // green → cyan (WhatsApp)
  ai:           ["#a855f7", "#ec4899"],   // purple → pink (IA / Sparkles)
  empresas:     ["#0ea5e9", "#6366f1"],   // sky → indigo (corporativo)
  crm:          ["#f97316", "#ec4899"],   // orange → pink (vendas)
  prospeccao:   ["#06b6d4", "#3b82f6"],   // cyan → blue (busca)
  leads:        ["#10b981", "#84cc16"],   // emerald → lime (alvo)
  oportunidades:["#facc15", "#f97316"],   // yellow → orange (lampada)
  calendario:   ["#06b6d4", "#0ea5e9"],   // cyan → sky (tempo)
  campanhas:    ["#ef4444", "#f59e0b"],   // red → amber (megafone)
  chamados:     ["#3b82f6", "#06b6d4"],   // blue → cyan (suporte)
  links:        ["#8b5cf6", "#3b82f6"],   // violet → blue (link)
  relatorios:   ["#10b981", "#06b6d4"],   // emerald → cyan (gráficos)
  configuracoes:["#64748b", "#475569"],   // slate (sutil — config é "neutro")

  // Configurações sub-itens
  instancias:   ["#22c55e", "#16a34a"],   // green (whatsapp gateway)
  empresa:      ["#0ea5e9", "#6366f1"],   // mesmo de empresas
  integracoes:  ["#6366f1", "#8b5cf6"],   // indigo → violet (plug)
  google:       ["#3b82f6", "#ef4444"],   // blue → red (cores Google)
  evolution:    ["#f59e0b", "#ef4444"],   // amber → red (raio)
  clickup:      ["#7c3aed", "#ec4899"],   // violet → pink
  openai:       ["#10b981", "#06b6d4"],   // emerald → cyan
  webhook:      ["#8b5cf6", "#06b6d4"],   // violet → cyan
  pipeline:     ["#ec4899", "#f97316"],   // pink → orange (CRM)
  setores:      ["#fbbf24", "#f59e0b"],   // yellow → amber (etiqueta)
  atendimento:  ["#06b6d4", "#3b82f6"],   // cyan → blue (relógio)
  email:        ["#3b82f6", "#06b6d4"],   // blue → cyan (envelope)

  // Cofre / vault
  cofre:        ["#f59e0b", "#dc2626"],   // amber → red (segurança)
  marketing:    ["#3b82f6", "#a855f7"],   // blue → purple (analytics)
  gamificacao:  ["#fbbf24", "#f97316"],   // yellow → orange (troféu)
} as const;

export type GradientKey = keyof typeof GRADIENTS;

export default function IconGradients() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {Object.entries(GRADIENTS).map(([key, [from, to]]) => (
          <linearGradient
            key={key}
            id={`grad-${key}`}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/** Retorna a string de URL pra usar em stroke / fill. */
export function gradStroke(key: GradientKey): string {
  return `url(#grad-${key})`;
}

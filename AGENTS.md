<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Identidade do projeto

LeadHub é um SaaS multi-tenant de propriedade da **Lazzari** (system owner).

- **SUPER_ADMIN** = "Diego Lazzari" (`diego@lazzari.net.br`) — dono da plataforma. NÃO é atendente da agência cliente. Aparece em SUPER_ADMIN-only flows (gerir empresas, planos, SMTP global, ClickUp tokens).
- **AZZ Agência de Marketing Digital** é uma **empresa-cliente** que usa o LeadHub. "Diego R. Lazzari" (`diego@azzagencia.com.br`) é o usuário **ADMIN da AZZ** — é quem opera o dia-a-dia: atende WhatsApp, fecha chamados, gerencia leads. Mesmo nome de família, contas separadas com responsabilidades diferentes.
- Quando o sistema mostra "Visualizando como cliente: AZZ Agência", é o SUPER_ADMIN impersonando — `getEffectiveSession()` retorna a sessão impersonada, `getServerSession()` a real.
- Filtros tipo `prisma.user.findMany({ where: { companyId } })` em listas de atendentes/assignees devem **excluir SUPER_ADMIN** (`role: { not: "SUPER_ADMIN" }`) — Lazzari não atende cliente da agência.
- ADMIN de uma empresa-cliente tem visão de gestor: vê todas as conversas/leads/chamados da própria empresa, não só atribuídos a si. SUPER_ADMIN tem visão global.

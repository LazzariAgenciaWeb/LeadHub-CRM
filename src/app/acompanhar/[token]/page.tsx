import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Página pública de acompanhamento do chamado (sem login), no padrão do painel
// do cliente em /c/[token]. Só existe quando o atendente marcou "cliente pode
// acompanhar" — revogar o link é apagar o publicToken.
// Mostra: status, assunto, quem atende e o andamento (mensagens NÃO internas).

const STATUS: Record<string, { label: string; color: string; hint: string }> = {
  OPEN:        { label: "Aberto",        color: "#38BDF8", hint: "Recebemos seu chamado e ele está na fila." },
  IN_PROGRESS: { label: "Em andamento",  color: "#FBBF24", hint: "Nossa equipe está trabalhando nisso." },
  RESOLVED:    { label: "Resolvido",     color: "#34D399", hint: "Concluímos o atendimento." },
  CLOSED:      { label: "Encerrado",     color: "#94A3B8", hint: "Este chamado foi encerrado." },
};

function fmt(d: Date) {
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function AcompanharChamado({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { publicToken: token },
    select: {
      title: true, description: true, status: true, priority: true, createdAt: true, dueDate: true,
      company:       { select: { name: true } },
      clientCompany: { select: { name: true } },
      assignee:      { select: { name: true } },
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, authorName: true, authorRole: true, createdAt: true },
      },
    },
  });

  if (!ticket) {
    return (
      <div style={{ minHeight: "100vh", background: "#06070C", color: "#727A8C", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif", fontSize: 14 }}>
        Link inválido ou expirado.
      </div>
    );
  }

  const st = STATUS[ticket.status] ?? STATUS.OPEN;

  return (
    <div style={{ minHeight: "100vh", background: "#06070C", color: "#E2E8F0", fontFamily: "system-ui,sans-serif", padding: "32px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>
          {ticket.company?.name ?? "Atendimento"}{ticket.clientCompany?.name ? ` · ${ticket.clientCompany.name}` : ""}
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 14px", lineHeight: 1.3 }}>{ticket.title}</h1>

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0C1220", border: "1px solid #1E2D45", borderRadius: 14, padding: "14px 16px" }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: st.color, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: st.color }}>{st.label}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94A3B8" }}>{st.hint}</p>
          </div>
        </div>

        {/* Dados */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "14px 0 22px", fontSize: 12, color: "#94A3B8" }}>
          <span>Aberto em {fmt(ticket.createdAt)}</span>
          {ticket.assignee?.name && <span>Responsável: {ticket.assignee.name}</span>}
          {ticket.dueDate && <span>Previsão: {fmt(ticket.dueDate)}</span>}
        </div>

        {/* Andamento */}
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748B", margin: "0 0 10px" }}>Andamento</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ticket.messages.length === 0 && (
            <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>Ainda não há atualizações por aqui.</p>
          )}
          {ticket.messages.map((m) => {
            const fromClient = m.authorRole === "CLIENT";
            return (
              <div
                key={m.id}
                style={{
                  background: fromClient ? "#10192B" : "#0C1220",
                  border: `1px solid ${fromClient ? "#24344F" : "#1E2D45"}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <p style={{ margin: 0, fontSize: 11, color: "#64748B" }}>
                  {m.authorName} · {fmt(m.createdAt)}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.body}</p>
              </div>
            );
          })}
        </div>

        <p style={{ marginTop: 28, fontSize: 11, color: "#475569" }}>
          Esta página atualiza sozinha conforme o atendimento avança. Guarde o link para consultar quando quiser.
        </p>
      </div>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { SYSTEM_TIMEZONE } from "@/lib/business-hours";

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

// A página é renderizada no SERVIDOR (que roda em UTC) — sem timeZone fixo, o
// cliente via 3h a mais. Formata sempre no fuso do sistema.
function fmt(d: Date) {
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: SYSTEM_TIMEZONE,
  });
}

type Item = { key: string; url: string; name: string };

// Print vira imagem (abre inteira ao clicar); outros arquivos, link.
function Anexos({ imgs, outros }: { imgs: Item[]; outros: Item[] }) {
  if (!imgs.length && !outros.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      {imgs.map((im) => (
        <a key={im.key} href={im.url} target="_blank" rel="noopener noreferrer" title={im.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.url} alt={im.name} loading="lazy"
            style={{ display: "block", maxWidth: "100%", maxHeight: 420, borderRadius: 10, border: "1px solid #1E2D45" }} />
        </a>
      ))}
      {outros.map((f) => (
        <a key={f.key} href={f.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: "#93C5FD", textDecoration: "none", padding: "7px 11px", borderRadius: 9, border: "1px solid #1E2D45", background: "#0C1220", alignSelf: "flex-start" }}>
          📎 {f.name}
        </a>
      ))}
    </div>
  );
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
      id: true,
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, body: true, authorName: true, authorRole: true, createdAt: true, mediaType: true,
          attachments: { where: { status: "READY" }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, mimeType: true } },
        },
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

  // Prints: imagem embutida antiga (sem carregar o base64 aqui — vem pela rota
  // de mídia) + arquivos do storage. As rotas aceitam ?t=<token> deste link.
  const [withMedia, ticketFiles] = await Promise.all([
    prisma.ticketMessage.findMany({
      where:  { ticketId: ticket.id, isInternal: false, mediaBase64: { not: null } },
      select: { id: true },
    }),
    prisma.storageObject.findMany({
      where:   { ticketId: ticket.id, ticketMessageId: null, status: "READY" },
      orderBy: { createdAt: "asc" },
      select:  { id: true, fileName: true, mimeType: true },
    }),
  ]);
  const mediaIds = new Set(withMedia.map((m) => m.id));
  const t = encodeURIComponent(token);
  const fileUrl = (fid: string) => `/api/storage/${fid}?t=${t}`;

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

        {ticketFiles.length > 0 && (
          <>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#64748B", margin: "0 0 10px" }}>Arquivos do chamado</p>
            <Anexos imgs={ticketFiles.filter((f) => f.mimeType.startsWith("image/")).map((f) => ({ key: f.id, url: fileUrl(f.id), name: f.fileName }))}
              outros={ticketFiles.filter((f) => !f.mimeType.startsWith("image/")).map((f) => ({ key: f.id, url: fileUrl(f.id), name: f.fileName }))} />
            <div style={{ height: 22 }} />
          </>
        )}

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
                {m.body.trim() && (
                  <p style={{ margin: "6px 0 0", fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.body}</p>
                )}
                <Anexos
                  imgs={[
                    ...(mediaIds.has(m.id) && (m.mediaType ?? "image/").startsWith("image/")
                      ? [{ key: "media", url: `/api/tickets/messages/${m.id}/media?t=${t}`, name: "print" }] : []),
                    ...m.attachments.filter((a) => a.mimeType.startsWith("image/")).map((a) => ({ key: a.id, url: fileUrl(a.id), name: a.fileName })),
                  ]}
                  outros={[
                    ...(mediaIds.has(m.id) && !(m.mediaType ?? "image/").startsWith("image/")
                      ? [{ key: "media", url: `/api/tickets/messages/${m.id}/media?t=${t}`, name: "Arquivo" }] : []),
                    ...m.attachments.filter((a) => !a.mimeType.startsWith("image/")).map((a) => ({ key: a.id, url: fileUrl(a.id), name: a.fileName })),
                  ]}
                />
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

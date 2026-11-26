import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SYSTEM_TIMEZONE } from "@/lib/business-hours";
import { storageEnabled } from "@/lib/storage/s3";
import { clientePendencias } from "@/lib/client-pendencias";
import ClientePendencias, { PortalAcesso } from "@/components/ClientePendencias";
import { SHELL_CSS, BrandBar, brandVars } from "@/components/ClientePublicShell";
import ClienteResponder from "./ClienteResponder";
import ClienteConfirmar from "./ClienteConfirmar";

export const dynamic = "force-dynamic";

// Página pública de acompanhamento do chamado (sem login), no padrão do painel
// do cliente em /c/[token]. Só existe quando o atendente marcou "cliente pode
// acompanhar" — revogar o link é apagar o publicToken.
// Mostra: status, assunto, quem atende e o andamento (mensagens NÃO internas),
// e deixa o cliente escrever de volta (texto + anexo) pela caixa no fim.
// Veste a mesma casca do link de aprovação (ClientePublicShell): logo da
// agência no topo, cor dela como acento e o botão do portal com o contador do
// que mais espera o cliente (peças pra aprovar e os outros chamados dele).

const STATUS: Record<string, { label: string; tone: "info" | "warn" | "ok" | ""; hint: string }> = {
  OPEN:        { label: "Aberto",        tone: "info", hint: "Recebemos seu chamado e ele está na fila." },
  IN_PROGRESS: { label: "Em andamento",  tone: "warn", hint: "Nossa equipe está trabalhando nisso." },
  RESOLVED:    { label: "Resolvido · aguardando sua confirmação", tone: "ok", hint: "Concluímos o atendimento. Confirme logo abaixo se ficou tudo certo." },
  CLOSED:      { label: "Encerrado",     tone: "",     hint: "Este chamado foi encerrado." },
};

// Só o que é da tela do chamado; o resto (fundo, cartões, cabeçalho) vem da
// casca compartilhada com a aprovação.
const STYLE = `
.apw.tk{padding-bottom:60px}
@media (min-width:640px){.apw.tk{max-width:760px;padding:28px 24px 80px}}
.chip.info{color:#9DB4FF;border-color:rgba(110,134,255,.4);background:rgba(110,134,255,.1)}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px;font-size:13px;color:var(--ink3)}
.meta b{color:var(--ink2);font-weight:600}
.hist{display:flex;flex-direction:column;gap:8px}
.msg{padding:10px 12px;border-radius:12px;font-size:14px;background:var(--card);border:1px solid var(--line)}
.msg.me{background:color-mix(in srgb,var(--accent) 9%,transparent);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}
.msg .mh{font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:4px}
.msg.me .mh{color:var(--accent)}
.msg .mh small{font-weight:400;color:var(--ink3);margin-left:6px}
.msg .bd{white-space:pre-wrap;word-break:break-word;line-height:1.55}
.anx{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.anx img{display:block;max-width:100%;max-height:420px;border-radius:10px;border:1px solid var(--line2)}
.anx a.fl{align-self:flex-start;font-size:13px;color:var(--ink);text-decoration:none;padding:8px 12px;border-radius:10px;border:1px solid var(--line2);background:#0B0D15}
.empty{margin:0;font-size:13px;color:var(--ink3)}
`;

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
    <div className="anx">
      {imgs.map((im) => (
        <a key={im.key} href={im.url} target="_blank" rel="noopener noreferrer" title={im.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${im.url}&v=view`} alt={im.name} loading="lazy" />
        </a>
      ))}
      {outros.map((f) => (
        <a key={f.key} className="fl" href={f.url} target="_blank" rel="noopener noreferrer">📎 {f.name}</a>
      ))}
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const t = await prisma.ticket.findUnique({ where: { publicToken: token }, select: { title: true } });
  return { title: t ? `Chamado · ${t.title}` : "Chamado", robots: { index: false, follow: false } };
}

export default async function AcompanharChamado({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { publicToken: token },
    select: {
      title: true, description: true, status: true, priority: true, createdAt: true, dueDate: true,
      // Agência dona do chamado: a tela veste a identidade dela.
      company:       { select: { name: true, tradeName: true, logoUrl: true, brandColor: true, googleReviewUrl: true } },
      // Confirmação do cliente e nota do atendimento (lib/ticket-confirm).
      confirmDueAt: true, confirmedByName: true, autoClosedAt: true, rating: true, ratingComment: true,
      clientCompany: { select: { name: true } },
      assignee:      { select: { name: true } },
      id: true, companyId: true, clientCompanyId: true,
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
      <div style={{ minHeight: "100vh", background: "#06070C", color: "#727A8C", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif", fontSize: 14, padding: 16, textAlign: "center" }}>
        Link inválido ou expirado. Fale com a agência pelo grupo.
      </div>
    );
  }

  const st = STATUS[ticket.status] ?? STATUS.OPEN;

  // Prints: imagem embutida antiga (sem carregar o base64 aqui — vem pela rota
  // de mídia) + arquivos do storage. As rotas aceitam ?t=<token> deste link.
  // Alerta de "tem mais coisa esperando você": peça pra aprovar e os OUTROS
  // chamados dele em aberto — este não entra na lista.
  const [withMedia, ticketFiles, pendencias] = await Promise.all([
    prisma.ticketMessage.findMany({
      where:  { ticketId: ticket.id, isInternal: false, mediaBase64: { not: null } },
      select: { id: true },
    }),
    prisma.storageObject.findMany({
      where:   { ticketId: ticket.id, ticketMessageId: null, status: "READY" },
      orderBy: { createdAt: "asc" },
      select:  { id: true, fileName: true, mimeType: true },
    }),
    clientePendencias({
      agencyCompanyId: ticket.companyId,
      clientCompanyId: ticket.clientCompanyId,
      exceto:          { ticketId: ticket.id },
    }),
  ]);
  const mediaIds = new Set(withMedia.map((m) => m.id));
  const t = encodeURIComponent(token);
  const fileUrl = (fid: string) => `/api/storage/${fid}?t=${t}`;

  const brand = {
    name:    ticket.company?.tradeName || ticket.company?.name || "Atendimento",
    logoUrl: ticket.company?.logoUrl ?? null,
    color:   ticket.company?.brandColor ?? null,
  };
  const img = (f: { mimeType: string }) => f.mimeType.startsWith("image/");

  return (
    <div className="ap" style={brandVars(brand.color)}>
      <style>{SHELL_CSS + STYLE}</style>
      <div className="apw tk">
        <BrandBar brand={brand} label="Acompanhar chamado">
          <PortalAcesso
            aprovacoes={pendencias.aprovacoes}
            chamados={pendencias.chamados}
            temAcesso={pendencias.temAcesso}
            agencia={pendencias.agencia}
            origem={{ kind: "chamado", token }}
          />
        </BrandBar>

        <div className="eyebrow">
          {ticket.clientCompany?.name && <span>{ticket.clientCompany.name}</span>}
          <span className={`chip ${st.tone}`}>● {st.label}</span>
        </div>
        <h1>{ticket.title}</h1>
        <div className="meta">
          <span>Aberto em {fmt(ticket.createdAt)}</span>
          {ticket.assignee?.name && <span>Responsável: <b>{ticket.assignee.name}</b></span>}
          {ticket.dueDate && <span>Previsão: <b>{fmt(ticket.dueDate)}</b></span>}
        </div>

        <div className={`banner ${st.tone === "ok" ? "ok" : "info"}`}>{st.hint}</div>

        {/* Resolvido: "ficou tudo certo?". Encerrado: nota + avaliar no Google. */}
        <ClienteConfirmar
          token={token}
          status={ticket.status}
          dueText={ticket.confirmDueAt
            ? ticket.confirmDueAt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: SYSTEM_TIMEZONE })
            : null}
          confirmedBy={ticket.confirmedByName}
          autoClosed={!!ticket.autoClosedAt}
          rating={ticket.rating}
          ratingComment={ticket.ratingComment}
          reviewUrl={ticket.company?.googleReviewUrl ?? null}
          agencyName={brand.name}
        />

        {ticketFiles.length > 0 && (
          <div className="card">
            <h3>Arquivos do chamado</h3>
            <Anexos imgs={ticketFiles.filter(img).map((f) => ({ key: f.id, url: fileUrl(f.id), name: f.fileName }))}
              outros={ticketFiles.filter((f) => !img(f)).map((f) => ({ key: f.id, url: fileUrl(f.id), name: f.fileName }))} />
          </div>
        )}

        <div className="card">
          <h3>Andamento</h3>
          <div className="hist">
            {ticket.messages.length === 0 && <p className="empty">Ainda não há atualizações por aqui.</p>}
            {ticket.messages.map((m) => {
              const fromClient = m.authorRole === "CLIENT";
              const media = mediaIds.has(m.id);
              const mediaImg = media && (m.mediaType ?? "image/").startsWith("image/");
              return (
                <div key={m.id} className={`msg${fromClient ? " me" : ""}`}>
                  <div className="mh">{fromClient ? m.authorName : (m.authorName || brand.name)}<small>{fmt(m.createdAt)}</small></div>
                  {m.body.trim() && <div className="bd">{m.body}</div>}
                  <Anexos
                    imgs={[
                      ...(mediaImg ? [{ key: "media", url: `/api/tickets/messages/${m.id}/media?t=${t}`, name: "print" }] : []),
                      ...m.attachments.filter(img).map((a) => ({ key: a.id, url: fileUrl(a.id), name: a.fileName })),
                    ]}
                    outros={[
                      ...(media && !mediaImg ? [{ key: "media", url: `/api/tickets/messages/${m.id}/media?t=${t}`, name: "Arquivo" }] : []),
                      ...m.attachments.filter((a) => !img(a)).map((a) => ({ key: a.id, url: fileUrl(a.id), name: a.fileName })),
                    ]}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <ClienteResponder token={token} status={ticket.status} storageOn={storageEnabled()} />

        {/* Peças pra aprovar e os OUTROS chamados dele em aberto. O portal fica
            no botão do topo, como na aprovação. */}
        <ClientePendencias
          aprovacoes={pendencias.aprovacoes}
          chamados={pendencias.chamados}
          temAcesso={pendencias.temAcesso}
          agencia={pendencias.agencia}
          origem={{ kind: "chamado", token }}
          semPortal
        />

        <p className="made">
          Esta página atualiza sozinha conforme o atendimento avança. Guarde o link para consultar e responder quando quiser.
          <br />{brand.name}
        </p>
      </div>
    </div>
  );
}

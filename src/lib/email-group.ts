/**
 * Agrupamento das cópias do mesmo email na listagem da caixa.
 *
 * O mesmo email chega em várias caixas da empresa (redirecionamento, cópia) e
 * cada caixa guarda a sua cópia — é isso que faz a permissão por setor
 * funcionar. Na tela, porém, isso vira linha repetida: aqui as cópias viram
 * UMA linha com as etiquetas de todas as caixas.
 *
 * Regra dos sinais na união: prevalece o que exige atenção — não lido em
 * qualquer caixa deixa a linha não lida, suspeita em qualquer cópia marca a
 * linha, e vínculo/tag/anexo de qualquer cópia aparece.
 *
 * Como as cópias são reconhecidas:
 *  1. mesmo Message-ID — o caso do redirecionamento (a mensagem é a mesma);
 *  2. mesma impressão digital — mesmo remetente, mesmo assunto, horário a até
 *     10 min de distância e CAIXAS DIFERENTES. Isso cobre o sistema que
 *     dispara um email pra cada destinatário (cada disparo ganha um
 *     Message-ID próprio, mas pra quem lê é o mesmo email).
 * A exigência de caixas diferentes é a trava: duas mensagens de verdade que
 * caíram na mesma caixa nunca se fundem.
 */

/** Distância máxima entre cópias quando o Message-ID não bate (minutos). */
export const COPY_WINDOW_MIN = 10;

/** Assunto comparável: sem Re:/Fwd:, sem espaço duplicado, minúsculo. */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .toLowerCase()
    .replace(/^((re|res|fw|fwd|enc|encaminhada?):\s*)+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave "é o mesmo email" quando o Message-ID difere. */
export function fingerprintKey(e: { fromEmail?: string | null; subject?: string | null }): string | null {
  const from = (e.fromEmail ?? "").toLowerCase();
  const subject = normalizeSubject(e.subject);
  return from && subject ? `${from}|${subject}` : null;
}

function millis(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Horários próximos o bastante pra serem a mesma mensagem. */
export function withinCopyWindow(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  const ta = millis(a), tb = millis(b);
  if (ta === null || tb === null) return false;
  return Math.abs(ta - tb) <= COPY_WINDOW_MIN * 60_000;
}

export interface GroupableEmail {
  id: string;
  messageId?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  sentAt?: Date | string | null;
  seen?: boolean;
  suspicious?: boolean;
  accountId?: string | null;
  account?: { id: string; label: string | null; fromEmail: string } | null;
  tags?: { id: string; name: string; color: string }[];
  leadId?: string | null;
  lead?: { id: string; name: string | null } | null;
  ticketId?: string | null;
  ticket?: { id: string; title: string } | null;
  _count?: { attachments: number } | null;
}

export type GroupedEmail<T extends GroupableEmail> = T & {
  /** Caixas (visíveis ao usuário) onde este mesmo email está. */
  boxes: NonNullable<T["account"]>[];
  /** Quantas cópias entraram na linha. */
  copies: number;
};

/**
 * Colapsa as cópias mantendo a ordem de entrada (a primeira — mais recente —
 * é a linha) e corta em `take`.
 */
export function groupEmailCopies<T extends GroupableEmail>(rows: T[], take: number): GroupedEmail<T>[] {
  const groups: GroupedEmail<T>[] = [];
  const byMessageId = new Map<string, number>();
  const byFingerprint = new Map<string, number[]>();

  for (const r of rows) {
    let at = r.messageId ? byMessageId.get(r.messageId) : undefined;
    const fp = fingerprintKey(r);

    // Sem Message-ID igual, tenta a impressão digital — exigindo caixa
    // diferente, que é o que garante ser cópia e não mensagem repetida.
    if (at === undefined && fp) {
      for (const idx of byFingerprint.get(fp) ?? []) {
        const g = groups[idx];
        const outraCaixa = !!r.accountId && !g.boxes.some((b) => b.id === r.accountId);
        if (outraCaixa && withinCopyWindow(g.sentAt, r.sentAt)) { at = idx; break; }
      }
    }

    if (at === undefined) {
      const idx = groups.length;
      if (r.messageId) byMessageId.set(r.messageId, idx);
      if (fp) byFingerprint.set(fp, [...(byFingerprint.get(fp) ?? []), idx]);
      groups.push({
        ...r,
        // cópia do array: unir tags não pode mexer no objeto original
        tags: r.tags ? [...r.tags] : r.tags,
        boxes: r.account ? [r.account as NonNullable<T["account"]>] : [],
        copies: 1,
      });
      continue;
    }

    // Cópia reconhecida por impressão digital traz o Message-ID dela pro
    // mesmo grupo — as próximas do mesmo identificador caem aqui direto.
    if (r.messageId && !byMessageId.has(r.messageId)) byMessageId.set(r.messageId, at);

    const g = groups[at];
    g.copies++;
    if (r.account && !g.boxes.some((b) => b.id === r.account!.id)) {
      g.boxes.push(r.account as NonNullable<T["account"]>);
    }
    if (r.seen === false) g.seen = false;
    if (r.suspicious) g.suspicious = true;
    if (!g.lead && r.lead) { g.lead = r.lead; g.leadId = r.leadId; }
    if (!g.ticket && r.ticket) { g.ticket = r.ticket; g.ticketId = r.ticketId; }
    if ((r._count?.attachments ?? 0) > (g._count?.attachments ?? 0)) g._count = r._count;
    if (r.tags?.length) {
      g.tags = g.tags ?? [];
      for (const t of r.tags) if (!g.tags.some((x) => x.id === t.id)) g.tags.push(t);
    }
  }

  return groups.slice(0, take);
}

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
 * linha, e vínculo/tag/anexo de qualquer cópia aparece. Email sem
 * Message-ID não agrupa (não há como afirmar que é o mesmo).
 */

export interface GroupableEmail {
  id: string;
  messageId?: string | null;
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
  const indexByKey = new Map<string, number>();

  for (const r of rows) {
    const key = r.messageId ? `m:${r.messageId}` : `i:${r.id}`;
    const at = indexByKey.get(key);

    if (at === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        ...r,
        // cópia do array: unir tags não pode mexer no objeto original
        tags: r.tags ? [...r.tags] : r.tags,
        boxes: r.account ? [r.account as NonNullable<T["account"]>] : [],
        copies: 1,
      });
      continue;
    }

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

/**
 * Datas de vigência do contrato (ClientService).
 *
 * A regra que importa: encerrar carimba `endedAt` sozinho, e reabrir limpa.
 * Deixar a data por conta de quem preenche o formulário garantiria contrato
 * marcado ENCERRADO sem data — e aí o histórico não responde "até quando esse
 * cliente teve isso", que é justamente pra isso que a data existe.
 */

export interface VigenciaNormalizada {
  startedAt?: Date | null;
  endedAt?: Date | null;
}

function data(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function cleanVigencia(
  body: unknown,
  statusNovo: string | undefined,
  statusAtual: string,
  endedAtAtual: Date | null
): VigenciaNormalizada {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: VigenciaNormalizada = {};

  if (b.startedAt !== undefined) out.startedAt = data(b.startedAt);

  // Data informada à mão manda — encerramento retroativo é comum ("saiu em
  // março, só estou registrando agora").
  if (b.endedAt !== undefined) {
    out.endedAt = data(b.endedAt);
    return out;
  }

  const status = statusNovo ?? statusAtual;
  if (status === "ENCERRADO" && statusAtual !== "ENCERRADO") {
    out.endedAt = endedAtAtual ?? new Date();
  } else if (status !== "ENCERRADO" && statusAtual === "ENCERRADO") {
    // Reativou: a data de fim deixa de valer, senão o contrato fica ativo e
    // encerrado ao mesmo tempo.
    out.endedAt = null;
  }
  return out;
}

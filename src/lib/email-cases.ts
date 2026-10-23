/**
 * Agrupamento por CASO na listagem da caixa.
 *
 * Cópia do mesmo email em várias caixas já vira uma linha (email-group.ts).
 * Falta o outro tipo de repetição: mensagens DIFERENTES que tratam do mesmo
 * assunto. O registro.br é o exemplo — pelo mesmo domínio ele dispara "aviso
 * de vencimento", "lembrete de renovação", "renovação" e "fatura", cada um
 * com assunto próprio. Na Entrada isso vira quatro linhas pra uma coisa só
 * de resolver.
 *
 * O que amarra as mensagens é um IDENTIFICADOR no assunto: o nome do domínio,
 * o número do boleto/nota/contrato. Então a chave do caso é
 * `remetente + identificador`, e só quando não há identificador nenhum cai
 * pro `remetente + assunto` (que é o caso de reenvio do mesmo aviso).
 *
 * Travas contra juntar o que não é do mesmo caso:
 *  - remetente de provedor público (gmail, hotmail…) agrupa pelo endereço
 *    exato, nunca pelo domínio — senão dois clientes diferentes com o mesmo
 *    número no assunto cairiam juntos;
 *  - janela de tempo (CASE_WINDOW_DAYS): fatura deste ano não junta com a do
 *    ano passado;
 *  - grupo de um só não existe: linha solta continua linha solta.
 *
 * Funções puras — testadas em `npm run test:email-cases`.
 */
import { normalizeSubject } from "./email-group";

/** Janela do caso: mensagens mais distantes que isso não se juntam. */
export const CASE_WINDOW_DAYS = 120;

/** Provedores públicos: agrupar pelo domínio juntaria gente diferente. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br",
  "outlook.com", "outlook.com.br", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.br", "icloud.com", "me.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br",
  "protonmail.com", "proton.me", "zipmail.com.br",
]);

/** Terminações de domínio reconhecidas dentro do assunto. */
const TLD = "(?:com\\.br|net\\.br|org\\.br|gov\\.br|adv\\.br|eco\\.br|app\\.br|ind\\.br|psi\\.br|vet\\.br|com|net|org|br|io|dev|app|me|co|shop|site|online|tech|digital)";
const DOMINIO_NO_ASSUNTO = new RegExp(`\\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.${TLD})\\b`, "gi");
/** Boleto, nota, contrato, protocolo: sequência longa de dígitos. */
const NUMERO_LONGO = /\b\d{6,}\b/g;

/** Domínio do endereço ("x@Registro.BR" → "registro.br"). */
export function senderDomain(email: string | null | undefined): string {
  const at = (email ?? "").toLowerCase().trim().split("@");
  return at.length === 2 ? at[1] : "";
}

/**
 * Identificadores do assunto, em ordem de confiança: nome de domínio primeiro
 * (é o que amarra o caso do registro.br), depois número longo.
 *
 * `ignorar` tira da jogada o domínio do PRÓPRIO remetente: "Registro.br -
 * Renovacao de dominio - expopalotina.com.br" tem dois domínios, e o que
 * identifica o caso é o segundo. Sem isso, essa mensagem ficava sozinha
 * enquanto as outras quatro do mesmo domínio se juntavam.
 */
export function caseTokens(subject: string | null | undefined, ignorar?: string | null): string[] {
  const s = (subject ?? "").toLowerCase();
  const fora = (ignorar ?? "").toLowerCase().trim();
  const dominios = [...s.matchAll(DOMINIO_NO_ASSUNTO)]
    .map((m) => m[1])
    .filter((d) => !fora || (d !== fora && !fora.endsWith(`.${d}`) && !d.endsWith(`.${fora}`)));
  const numeros = [...s.matchAll(NUMERO_LONGO)].map((m) => m[0]);
  return [...new Set([...dominios, ...numeros])];
}

export interface CaseableEmail {
  id: string;
  fromEmail?: string | null;
  subject?: string | null;
  sentAt?: Date | string | null;
}

/**
 * Chave do caso. Mensagens com a mesma chave (e dentro da janela) são a mesma
 * coisa de resolver. `null` = não dá pra afirmar nada, fica solta.
 */
export function caseKeyOf(e: CaseableEmail): string | null {
  const from = (e.fromEmail ?? "").toLowerCase().trim();
  if (!from) return null;
  const dominio = senderDomain(from);
  // Provedor público → identidade é o endereço; empresa → o domínio todo
  // (registro.br manda de hostmaster@, cobranca@, avisos@…).
  const quem = !dominio || PUBLIC_EMAIL_DOMAINS.has(dominio) ? from : dominio;

  const token = caseTokens(e.subject, dominio)[0];
  if (token) return `${quem}|#${token}`;

  const assunto = normalizeSubject(e.subject);
  return assunto ? `${quem}|=${assunto}` : null;
}

function millis(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

export type CaseGrouped<T extends CaseableEmail> = T & {
  /** Ids de TODAS as linhas do caso (a desta linha incluída). */
  caseIds: string[];
  /** Quantas mensagens o caso tem (1 = linha solta). */
  caseCount: number;
  /** As outras mensagens do caso, da mais nova pra mais antiga. */
  caseMembers: T[];
};

/**
 * Junta as linhas do mesmo caso mantendo a ordem de entrada: a primeira (mais
 * recente) é a linha visível e as outras ficam dentro dela.
 *
 * Recebe a lista JÁ agrupada por cópia — a ordem de chegada precisa ser da
 * mais nova pra mais antiga, como a listagem devolve.
 */
export function groupEmailCases<T extends CaseableEmail>(rows: T[]): CaseGrouped<T>[] {
  const groups: CaseGrouped<T>[] = [];
  const porChave = new Map<string, number>();
  const janela = CASE_WINDOW_DAYS * 86_400_000;

  for (const r of rows) {
    const chave = caseKeyOf(r);
    const at = chave ? porChave.get(chave) : undefined;

    if (at !== undefined) {
      const g = groups[at];
      const tg = millis(g.sentAt), tr = millis(r.sentAt);
      // Dentro da janela? Junta. Fora, começa um caso novo com a mesma chave
      // (a fatura de agora não é a do ano passado).
      if (tg !== null && tr !== null && Math.abs(tg - tr) <= janela) {
        g.caseIds.push(r.id);
        g.caseMembers.push(r);
        g.caseCount++;
        continue;
      }
    }

    if (chave) porChave.set(chave, groups.length);
    groups.push({ ...r, caseIds: [r.id], caseCount: 1, caseMembers: [] });
  }

  return groups;
}

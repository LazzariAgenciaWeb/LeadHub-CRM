/**
 * Chaves do portal do cliente (/meu-espaco).
 *
 * PORTAL_FINANCEIRO_ATIVO — mostra ao cliente a página de boletos e notas
 * (/meu-espaco/financeiro), o item "Financeiro" no menu e o card na home.
 * Desligado enquanto a baixa das cobranças não é feita no sistema: sem a
 * baixa, conta já paga aparece como "em aberto"/"atrasada" pro cliente.
 * Pra religar, troque para `true` — nada mais precisa mudar.
 *
 * Não afeta o Financeiro interno da agência (/financeiro) nem a aba de
 * cobranças dentro do cadastro do cliente.
 */
export const PORTAL_FINANCEIRO_ATIVO = false;

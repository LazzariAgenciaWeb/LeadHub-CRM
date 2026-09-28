import type Anthropic from "@anthropic-ai/sdk";

/**
 * Camada de ações do assistente pessoal.
 *
 * Cada ferramenta é uma função tipada com schema JSON. É a ÚNICA forma de a
 * IA mexer no sistema — e a mesma lista é exposta em três portas: chat do app,
 * grupo do WhatsApp e MCP (Claude). O modelo escolhe *o quê*; o contexto
 * (`ToolContext`) vem sempre da sessão/token, nunca do modelo.
 */
export type ToolChannel = "APP" | "WHATSAPP" | "MCP";

export interface ToolContext {
  userId: string;
  userName: string;
  /** Empresa do usuário (agência). Escopo de tudo. */
  companyId: string;
  role: string;
  isAdmin: boolean;
  channel: ToolChannel;
  now: Date;
}

export type ToolResult =
  | { ok: true; message: string; data?: unknown; link?: string }
  | { ok: false; error: string };

export interface ToolDef<I = any> {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
  /** true = altera dados (usado pra log e pra política de confirmação). */
  mutating?: boolean;
  /** true = nunca executa direto: vira AssistantPendingAction até o usuário confirmar. */
  confirm?: boolean;
  /** Resumo humano da ação (mostrado no pedido de confirmação). */
  summarize?: (input: I) => string;
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export function ok(message: string, extra?: { data?: unknown; link?: string }): ToolResult {
  return { ok: true, message, ...extra };
}
export function fail(error: string): ToolResult {
  return { ok: false, error };
}

/** URL absoluta pro app (links nas respostas). */
export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

/** Parse tolerante de data vinda do modelo (ISO com offset). */
export function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "sem data";
  return d.toLocaleString("pt-BR", {
    timeZone: process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "sem data";
  return d.toLocaleDateString("pt-BR", {
    timeZone: process.env.SYSTEM_TIMEZONE || "America/Sao_Paulo",
    day: "2-digit", month: "2-digit",
  });
}
export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./types";
import { consultaTools } from "./consulta";
import { criarTools } from "./criar";
import { notasTools } from "./notas";
import { financeiroTools } from "./financeiro";
import { filaDoDia } from "./fila";
import { avisarNoWhatsapp } from "./avisos";
import { leadsTools } from "./leads";

export type { ToolDef, ToolContext, ToolResult, ToolChannel } from "./types";
export { buildFilaDoDia, formatFila, type FilaDoDia, type FilaItem } from "./fila";

/** Lista completa e ORDENADA (ordem estável = cache de prompt estável). */
export const ALL_TOOLS: ToolDef[] = [
  filaDoDia,
  ...consultaTools,
  ...notasTools,
  ...criarTools,
  ...leadsTools,
  ...financeiroTools,
];

/** Só pelo MCP: no chat/WhatsApp a resposta já vai pro canal. */
export const MCP_ONLY_TOOLS: ToolDef[] = [avisarNoWhatsapp];

const BY_NAME = new Map([...ALL_TOOLS, ...MCP_ONLY_TOOLS].map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

/** Definições no formato da API da Anthropic. */
export function anthropicToolDefs(): Anthropic.Tool[] {
  return ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

/** Definições no formato MCP (tools/list). */
export function mcpToolDefs() {
  return [...ALL_TOOLS, ...MCP_ONLY_TOOLS].map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
}

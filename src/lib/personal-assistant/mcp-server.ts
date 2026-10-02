import { NextRequest, NextResponse } from "next/server";
import { mcpToolDefs } from "@/lib/assistant-tools/registry";
import { runToolDirect } from "./engine";
import { userCanUseAssistant } from "./access";
import { authenticateAssistantToken } from "./token-auth";

/**
 * Servidor MCP do GoHub (Streamable HTTP, JSON-RPC 2.0, sem SSE).
 *
 * Mesmas ferramentas do assistente pessoal, pro Claude (Claude Code, claude.ai
 * ou qualquer cliente MCP). Duas formas de autenticar com o token pessoal:
 *   - header `Authorization: Bearer gohub_...`  → /api/mcp  (Claude Code)
 *   - token na URL                               → /api/mcp/t/<token>  (claude.ai
 *     "conector personalizado" sem autenticação — ele não envia headers fixos)
 */
export const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "gohub", version: "1.0.0" };

type RpcReq = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

function rpcResult(id: RpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: RpcReq["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

async function handleOne(msg: RpcReq, userId: string): Promise<unknown | null> {
  const { id, method, params } = msg;
  const isNotification = id === undefined;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "GoHub: gestão da agência (clientes, projetos, chamados, financeiro, WhatsApp) e bloquinho pessoal do usuário. Use buscar_cliente antes de criar algo para um cliente. Datas em ISO 8601 com fuso -03:00. Ações financeiras (lancar_cobranca) executam imediatamente: confirme com o usuário antes de chamar. Pra entregar resultados de rotinas ao usuário, use avisar_no_whatsapp (resumo curto) e criar_tarefa_pessoal/anotar (itens de ação).",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpToolDefs() });
    case "tools/call": {
      const name = params?.name;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof name !== "string") return rpcError(id, -32602, "Parâmetro 'name' obrigatório");
      const r = await runToolDirect(userId, "MCP", name, args);
      const text = r.ok ? `${r.message}${r.link ? `\nLink: ${r.link}` : ""}` : `ERRO: ${r.error}`;
      return rpcResult(id, {
        content: [{ type: "text", text }],
        isError: !r.ok,
        ...(r.ok && r.data !== undefined ? { structuredContent: { data: r.data } } : {}),
      });
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Método não suportado: ${method}`);
  }
}

/** POST JSON-RPC. `tokenOverride` = token vindo da URL (/api/mcp/t/<token>). */
export async function mcpPost(req: NextRequest, tokenOverride?: string): Promise<NextResponse> {
  const auth = await authenticateAssistantToken(req, tokenOverride);
  if (!auth) {
    return NextResponse.json(rpcError(null, -32001, "Não autorizado: envie Authorization: Bearer <token>"), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="gohub-mcp"' },
    });
  }
  if (!(await userCanUseAssistant(auth.userId))) {
    return NextResponse.json(rpcError(null, -32003, "Assistente pessoal não liberado para a sua empresa"), { status: 403 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json(rpcError(null, -32700, "JSON inválido"), { status: 400 }); }

  const batch = Array.isArray(body);
  const msgs: RpcReq[] = batch ? body : [body];
  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") { out.push(rpcError(m?.id ?? null, -32600, "Requisição inválida")); continue; }
    try {
      const r = await handleOne(m, auth.userId);
      if (r !== null) out.push(r);
    } catch (e: any) {
      out.push(rpcError(m.id ?? null, -32603, e?.message ?? "erro interno"));
    }
  }
  if (out.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? out : out[0], { headers: { "Mcp-Protocol-Version": PROTOCOL_VERSION } });
}

/** Sem stream SSE server→client: GET responde 405 conforme a spec. */
export function mcpGet(): NextResponse {
  return NextResponse.json({ error: "Method Not Allowed — use POST (JSON-RPC)" }, { status: 405, headers: { Allow: "POST, DELETE" } });
}

export function mcpDelete(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

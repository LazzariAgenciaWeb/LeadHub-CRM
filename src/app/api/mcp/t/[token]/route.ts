import { NextRequest } from "next/server";
import { mcpPost, mcpGet, mcpDelete } from "@/lib/personal-assistant/mcp-server";

/**
 * MCP do GoHub com o token pessoal NA URL: /api/mcp/t/<token>.
 *
 * Pro claude.ai (Configurações → Conectores → "Adicionar conector
 * personalizado" → autenticação "nenhuma"): ele não manda header fixo, então a
 * própria URL é o segredo — mesma ideia do token de webhook. Trate a URL como
 * senha; gerar um novo token invalida a antiga.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return mcpPost(req, token);
}
export async function GET() {
  return mcpGet();
}
export async function DELETE() {
  return mcpDelete();
}

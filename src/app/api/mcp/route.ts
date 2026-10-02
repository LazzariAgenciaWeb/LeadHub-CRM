import { NextRequest } from "next/server";
import { mcpPost, mcpGet, mcpDelete } from "@/lib/personal-assistant/mcp-server";

/**
 * MCP do GoHub — autenticação por header `Authorization: Bearer <token pessoal>`.
 * Claude Code:
 *   claude mcp add --transport http gohub https://app.../api/mcp \
 *     --header "Authorization: Bearer gohub_..."
 * Pro claude.ai (conector personalizado sem header) use /api/mcp/t/<token>.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return mcpPost(req);
}
export async function GET() {
  return mcpGet();
}
export async function DELETE() {
  return mcpDelete();
}

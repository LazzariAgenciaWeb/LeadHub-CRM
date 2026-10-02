import { authorizationServerMetadata, corsJson, corsPreflight } from "@/lib/personal-assistant/oauth";

/** RFC 8414 — descoberta do servidor OAuth (claude.ai lê isto antes de conectar o MCP). */
export async function GET() {
  return corsJson(authorizationServerMetadata());
}
export async function OPTIONS() {
  return corsPreflight();
}

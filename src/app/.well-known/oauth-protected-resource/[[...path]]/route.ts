import { protectedResourceMetadata, corsJson, corsPreflight } from "@/lib/personal-assistant/oauth";

/** RFC 9728 — metadata do recurso protegido (/api/mcp). Serve na raiz e no sufixo /api/mcp. */
export async function GET() {
  return corsJson(protectedResourceMetadata());
}
export async function OPTIONS() {
  return corsPreflight();
}

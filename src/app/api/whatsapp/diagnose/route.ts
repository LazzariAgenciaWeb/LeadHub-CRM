import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/whatsapp/diagnose
 * Testa a conexão com a Evolution API e retorna diagnóstico completo.
 * Apenas SUPER_ADMIN.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const userRole = (session.user as any).role;
  if (userRole !== "SUPER_ADMIN") return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });

  // 1. Ler configurações do banco
  const settings = await prisma.setting.findMany({
    where: { key: { in: ["evolution_base_url", "evolution_api_key"] } },
  });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  const baseUrl = map["evolution_base_url"]?.replace(/\/$/, "") ?? null;
  const apiKey = map["evolution_api_key"] ?? null;

  const result: Record<string, any> = {
    config: {
      baseUrl,
      apiKeyLength: apiKey ? apiKey.length : 0,
      apiKeyPreview: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : null,
    },
    tests: {},
  };

  if (!baseUrl || !apiKey) {
    result.error = "evolution_base_url ou evolution_api_key não configurados no banco";
    return NextResponse.json(result);
  }

  // 2. Teste 1: listar instâncias (endpoint simples)
  try {
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: { "Content-Type": "application/json", apikey: apiKey },
    });
    const body = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch {}
    result.tests.fetchInstances = {
      status: res.status,
      ok: res.ok,
      // Mostra só nome + connectionStatus de cada instância
      instances: Array.isArray(parsed)
        ? parsed.map((i: any) => ({ name: i.name ?? i.instanceName, connectionStatus: i.connectionStatus ?? i.state, token: i.token ? i.token.slice(0, 8) + "..." : null }))
        : parsed,
    };
  } catch (e: any) {
    result.tests.fetchInstances = { error: e.message };
  }

  // 3. Testa criar instância Atendimento_azz na Evolution
  try {
    const res = await fetch(`${baseUrl}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        instanceName: "Atendimento_azz",
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });
    const body = await res.text();
    result.tests.createInstance = { status: res.status, ok: res.ok, body: body.slice(0, 300) };
  } catch (e: any) {
    result.tests.createInstance = { error: e.message };
  }

  // 4. Testa connect (QR) com chave global
  try {
    const res = await fetch(`${baseUrl}/instance/connect/Atendimento_azz`, {
      headers: { "Content-Type": "application/json", apikey: apiKey },
    });
    const body = await res.text();
    result.tests.connectGlobalKey = { status: res.status, ok: res.ok, body: body.slice(0, 300) };
  } catch (e: any) {
    result.tests.connectGlobalKey = { error: e.message };
  }

  // 5. Busca instâncias do banco para comparar nomes
  const dbInstances = await prisma.whatsappInstance.findMany({
    select: { id: true, instanceName: true, status: true },
  });
  result.dbInstances = dbInstances;

  return NextResponse.json(result, { status: 200 });
}

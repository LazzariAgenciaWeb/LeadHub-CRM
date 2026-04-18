import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClickupSettings } from "@/lib/clickup";

/**
 * GET /api/admin/debug-clickup
 * SUPER_ADMIN only — testa a conexão com o ClickUp e tenta criar uma tarefa
 * de teste para confirmar que os List IDs estão corretos.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const settings = await getClickupSettings();
  if (!settings) {
    return NextResponse.json({ error: "ClickUp não configurado (API token ausente)" }, { status: 503 });
  }

  const BASE = "https://api.clickup.com/api/v2";
  const headers = { Authorization: settings.apiToken, "Content-Type": "application/json" };

  // 1. Verifica token
  const userRes = await fetch(`${BASE}/user`, { headers });
  const userBody = await userRes.json();
  if (!userRes.ok) {
    return NextResponse.json({ step: "auth", error: userBody, status: userRes.status });
  }

  const results: Record<string, unknown> = {
    auth: { ok: true, user: userBody.user?.username ?? userBody.user?.email },
    ticketsListId: settings.ticketsListId || "(vazio)",
    oportunidadesListId: settings.oportunidadesListId || "(vazio)",
  };

  // 2. Verifica lista de Chamados
  if (settings.ticketsListId) {
    const listRes = await fetch(`${BASE}/list/${settings.ticketsListId}`, { headers });
    const listBody = await listRes.json();
    if (!listRes.ok) {
      results.ticketsList = { ok: false, status: listRes.status, error: listBody };
    } else {
      results.ticketsList = {
        ok: true,
        name: listBody.name,
        statuses: listBody.statuses?.map((s: any) => s.status) ?? [],
      };
    }

    // 3. Tenta criar tarefa de teste (sem status)
    const createRes = await fetch(`${BASE}/list/${settings.ticketsListId}/task`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "[TESTE LeadHub] Diagnóstico — pode excluir" }),
    });
    const createBody = await createRes.json();
    if (!createRes.ok) {
      results.createTask = { ok: false, status: createRes.status, error: createBody };
    } else {
      results.createTask = { ok: true, taskId: createBody.id, url: createBody.url };
      // Exclui a tarefa de teste automaticamente
      await fetch(`${BASE}/task/${createBody.id}`, { method: "DELETE", headers });
      results.cleanup = "tarefa de teste excluída";
    }
  }

  return NextResponse.json(results, { status: 200 });
}

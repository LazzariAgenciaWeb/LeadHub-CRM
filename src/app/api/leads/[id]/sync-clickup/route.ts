import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClickupSettings } from "@/lib/clickup";

const BASE = "https://api.clickup.com/api/v2";

/**
 * POST /api/leads/[id]/sync-clickup
 * Cria (ou re-cria) a tarefa no ClickUp para esta oportunidade e retorna o resultado detalhado.
 * Usado pelo botão "Criar no ClickUp" na UI do CRMBoard.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id: leadId } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!lead) return NextResponse.json({ error: "Oportunidade não encontrada" }, { status: 404 });

  const settings = await getClickupSettings(lead.companyId);
  if (!settings) {
    return NextResponse.json(
      { error: "ClickUp não configurado. Verifique API Token em Configurações → Integrações → ClickUp." },
      { status: 503 }
    );
  }
  if (!settings.oportunidadesListId) {
    return NextResponse.json(
      { error: "List ID de Oportunidades não configurado. Verifique em Configurações → Integrações → ClickUp." },
      { status: 503 }
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const leadhubUrl = `${baseUrl}/crm/oportunidades?lead=${lead.id}`;

  // Monta descrição com informações da oportunidade
  const descParts: string[] = [];
  if (lead.notes) descParts.push(lead.notes);
  if (lead.value != null) {
    descParts.push(`💰 Valor: R$ ${lead.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  }
  if (lead.phone) descParts.push(`📱 Telefone: ${lead.phone}`);
  if (lead.email) descParts.push(`📧 E-mail: ${lead.email}`);
  if (lead.company) descParts.push(`🏢 Empresa: ${lead.company.name}`);
  descParts.push(`🔗 Ver no LeadHub: ${leadhubUrl}`);

  const description = descParts.join("\n\n");

  // Nome da tarefa — usa o nome do lead ou o telefone como fallback
  const taskName = lead.name ?? lead.phone;

  // Corpo da tarefa — mínimo necessário (sem status para evitar erro 400)
  const taskBody: Record<string, unknown> = {
    name: taskName,
    description,
  };

  // Prioridade (opcional)
  const PRIORITY_MAP: Record<string, number> = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
  // Oportunidades não têm campo priority — usa MEDIUM como padrão
  taskBody.priority = PRIORITY_MAP["MEDIUM"];

  // Chama a API do ClickUp diretamente para capturar o erro completo
  const res = await fetch(`${BASE}/list/${settings.oportunidadesListId}/task`, {
    method: "POST",
    headers: {
      Authorization: settings.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskBody),
  });

  const responseText = await res.text();
  let responseJson: any = null;
  try { responseJson = JSON.parse(responseText); } catch { /* not JSON */ }

  if (!res.ok) {
    return NextResponse.json({
      error: `ClickUp retornou ${res.status}`,
      clickupError: responseJson ?? responseText,
      listId: settings.oportunidadesListId,
      requestBody: taskBody,
    }, { status: 502 });
  }

  const taskId: string = responseJson?.id;
  if (!taskId) {
    return NextResponse.json({ error: "ClickUp não retornou task ID", response: responseJson }, { status: 502 });
  }

  // Salva no banco
  await prisma.lead.update({ where: { id: leadId }, data: { clickupTaskId: taskId } });

  return NextResponse.json({
    ok: true,
    clickupTaskId: taskId,
    clickupUrl: `https://app.clickup.com/t/${taskId}`,
  });
}

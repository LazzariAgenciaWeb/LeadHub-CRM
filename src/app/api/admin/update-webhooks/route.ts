import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSetWebhookEvents } from "@/lib/evolution";

/**
 * POST /api/admin/update-webhooks
 *
 * Atualiza a configuração de webhook de todas as instâncias existentes
 * para incluir o evento MESSAGES_UPDATE (necessário para ACK de leitura).
 * Rode uma única vez após o deploy que adicionou o suporte a ACK.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const baseUrl = req.nextUrl.origin;
  const webhookUrl = `${baseUrl}/api/webhook/whatsapp`;

  const instances = await prisma.whatsappInstance.findMany({
    select: { id: true, instanceName: true },
  });

  const results: { instanceName: string; ok: boolean; error?: string }[] = [];

  for (const inst of instances) {
    try {
      await evolutionSetWebhookEvents(inst.instanceName, webhookUrl);
      results.push({ instanceName: inst.instanceName, ok: true });
    } catch (err: any) {
      results.push({ instanceName: inst.instanceName, ok: false, error: err.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ updated: ok, failed, results });
}

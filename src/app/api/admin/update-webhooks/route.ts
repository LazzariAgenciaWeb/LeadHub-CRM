import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSetWebhookEvents, evolutionSetSettings } from "@/lib/evolution";
import { buildWhatsappWebhookUrl } from "@/lib/webhook-auth";

/**
 * POST /api/admin/update-webhooks
 *
 * Reconfigura na Evolution, pra cada instância do banco:
 *   1. URL do webhook + eventos (MESSAGES_UPSERT/UPDATE, CONNECTION, QRCODE)
 *   2. Setting `groupsIgnore` espelhando o `acceptGroups` do banco — assim o
 *      toggle do LeadHub fica como fonte da verdade e qualquer divergência
 *      manual feita direto na Evolution é corrigida.
 *
 * Roda quando o admin clica "Reconfigurar webhooks" em /configuracoes.
 */
export async function POST(req: NextRequest) {
  // Aceita autenticação via sessão de Super Admin OU via chave secreta interna
  const adminSecret = req.headers.get("x-admin-secret");
  const validSecret = adminSecret === (process.env.SYNC_SECRET ?? "leadhub-sync-secret");

  if (!validSecret) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any)?.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  // Usar NEXT_PUBLIC_BASE_URL para evitar endereço interno do Docker (0.0.0.0:3000)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
  const webhookUrl = buildWhatsappWebhookUrl(baseUrl);

  const instances = await (prisma.whatsappInstance.findMany as any)({
    select: { id: true, instanceName: true, instanceToken: true, acceptGroups: true },
  });

  const results: { instanceName: string; ok: boolean; error?: string }[] = [];

  for (const inst of instances) {
    try {
      await evolutionSetWebhookEvents(inst.instanceName, webhookUrl, inst.instanceToken ?? null);
      // Espelha o toggle do banco no setting da Evolution. Default acceptGroups=true → groupsIgnore=false.
      await evolutionSetSettings(
        inst.instanceName,
        { groupsIgnore: !inst.acceptGroups },
        inst.instanceToken ?? null,
      );
      results.push({ instanceName: inst.instanceName, ok: true });
    } catch (err: any) {
      results.push({ instanceName: inst.instanceName, ok: false, error: err.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ updated: ok, failed, results });
}

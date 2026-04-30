import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evolutionGetStatus } from "@/lib/evolution";

/**
 * GET/POST /api/cron/sync-instances
 *
 * Versão cron de /api/whatsapp/sync-all — sincroniza TODAS as instâncias
 * (de todas as empresas) com o estado real da Evolution API. Use para
 * manter o status do LeadHub coerente sem depender de webhook.
 *
 * Frequência sugerida: a cada 5-10 minutos via cron externo.
 *
 * Proteção: aceita Authorization: Bearer ${CRON_SECRET} se a env existir.
 */
async function handle(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const instances = await prisma.whatsappInstance.findMany({
    select: { id: true, instanceName: true, instanceToken: true, status: true },
  });

  const STATUS_MAP: Record<string, "CONNECTED" | "DISCONNECTED" | "CONNECTING"> = {
    open: "CONNECTED",
    connected: "CONNECTED",
    close: "DISCONNECTED",
    closed: "DISCONNECTED",
    disconnected: "DISCONNECTED",
    connecting: "CONNECTING",
  };

  let changed = 0;
  let failed = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < instances.length; i += CONCURRENCY) {
    const chunk = instances.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (inst) => {
        try {
          const raw = await evolutionGetStatus(inst.instanceName, inst.instanceToken ?? null);
          const stateRaw = String(
            (raw as any)?.instance?.state ??
            (raw as any)?.state ??
            (raw as any)?.connectionStatus ?? ""
          ).toLowerCase();
          const newStatus = STATUS_MAP[stateRaw] ?? "DISCONNECTED";
          if (newStatus !== inst.status) {
            await prisma.whatsappInstance.update({
              where: { id: inst.id },
              data: { status: newStatus },
            });
            changed++;
          }
        } catch {
          failed++;
        }
      })
    );
  }

  return NextResponse.json({
    ok: true,
    total: instances.length,
    changed,
    failed,
    timestamp: new Date().toISOString(),
  });
}

export const GET  = handle;
export const POST = handle;
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { evolutionGetStatus } from "@/lib/evolution";

/**
 * POST /api/whatsapp/sync-all
 *
 * Sincroniza o status de TODAS as instâncias visíveis pelo usuário
 * com o estado real reportado pela Evolution API.
 *
 * Útil quando o webhook connection.update perdeu eventos (Evolution
 * reiniciou, ou a instância já estava conectada antes do LeadHub subir).
 */
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userRole      = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  // Filtro de instâncias por permissão
  const where: any = {};
  if (userRole !== "SUPER_ADMIN") {
    if (!userCompanyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });
    where.companyId = userCompanyId;
  }

  const instances = await prisma.whatsappInstance.findMany({
    where,
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

  // Sincroniza em paralelo (limite de concorrência simples para não saturar a Evolution)
  const CONCURRENCY = 5;
  const results: { id: string; instanceName: string; before: string; after: string; changed: boolean; error?: string }[] = [];

  for (let i = 0; i < instances.length; i += CONCURRENCY) {
    const chunk = instances.slice(i, i + CONCURRENCY);
    const partial = await Promise.all(
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
          }
          return { id: inst.id, instanceName: inst.instanceName, before: inst.status, after: newStatus, changed: newStatus !== inst.status };
        } catch (err: any) {
          return {
            id: inst.id,
            instanceName: inst.instanceName,
            before: inst.status,
            after: inst.status,
            changed: false,
            error: err?.message ?? "erro desconhecido",
          };
        }
      })
    );
    results.push(...partial);
  }

  const summary = {
    total: results.length,
    changed: results.filter((r) => r.changed).length,
    failed: results.filter((r) => r.error).length,
    connected: results.filter((r) => r.after === "CONNECTED").length,
    connecting: results.filter((r) => r.after === "CONNECTING").length,
    disconnected: results.filter((r) => r.after === "DISCONNECTED").length,
  };

  return NextResponse.json({ ok: true, summary, results });
}

export const maxDuration = 60;

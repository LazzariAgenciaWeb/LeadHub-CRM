import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionGetStatus } from "@/lib/evolution";

// POST /api/whatsapp/[id]/sync
// Fetches the connection state from Evolution API and updates the DB
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const userRole = (session.user as any).role;
  const userCompanyId = (session.user as any).companyId;

  const instance = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!instance) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && instance.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  try {
    const instanceToken = (instance as any).instanceToken as string | null | undefined;
    const data: any = await evolutionGetStatus(instance.instanceName, instanceToken);

    // Evolution API pode retornar em vários formatos dependendo da versão:
    // v1: { instance: { state: "open" } }
    // v2: { instance: { instanceName: "...", state: "open" } }
    // v2 alt: { state: "open" }
    // v2 alt: { instanceName: "...", connectionStatus: "open" }
    const state: string = (
      data?.instance?.state ??
      data?.state ??
      data?.instance?.connectionStatus ??
      data?.connectionStatus ??
      ""
    ).toLowerCase();

    console.log("[Sync WA] instanceName:", instance.instanceName, "raw data:", JSON.stringify(data), "state:", state);

    const statusMap: Record<string, string> = {
      open: "CONNECTED",
      connected: "CONNECTED",
      close: "DISCONNECTED",
      closed: "DISCONNECTED",
      disconnected: "DISCONNECTED",
      connecting: "CONNECTING",
    };
    const newStatus = statusMap[state] ?? "DISCONNECTED";

    const updated = await prisma.whatsappInstance.update({
      where: { id },
      data: { status: newStatus as "CONNECTED" | "DISCONNECTED" | "CONNECTING" },
    });

    return NextResponse.json({ status: updated.status, raw: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

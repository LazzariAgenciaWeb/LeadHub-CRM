import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionGetStatus, evolutionGetInstanceNumber } from "@/lib/evolution";
import { assertModule } from "@/lib/billing";

// POST /api/whatsapp/[id]/sync
// Fetches the connection state from Evolution API and updates the DB
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const gate = await assertModule(session, "whatsapp");
  if (!gate.ok) return gate.response;

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
    const rawData = await evolutionGetStatus(instance.instanceName, instanceToken);
    const d = rawData as any;

    // Evolution API retorna em vários formatos dependendo da versão
    const state: string = String(
      d?.instance?.state ?? d?.state ?? d?.instance?.connectionStatus ?? d?.connectionStatus ?? ""
    ).toLowerCase();

    console.log("[Sync WA] instanceName:", instance.instanceName, "raw data:", JSON.stringify(rawData), "state:", state);

    const statusMap: Record<string, string> = {
      open: "CONNECTED",
      connected: "CONNECTED",
      close: "DISCONNECTED",
      closed: "DISCONNECTED",
      disconnected: "DISCONNECTED",
      connecting: "CONNECTING",
    };
    const newStatus = statusMap[state] ?? "DISCONNECTED";

    // Puxa o número real conectado da Evolution e preenche phone sozinho.
    // Best-effort: se a Evolution não devolver número (QR não escaneado
    // ainda), mantém o phone atual.
    const data: Record<string, unknown> = {
      status: newStatus as "CONNECTED" | "DISCONNECTED" | "CONNECTING",
    };
    try {
      const number = await evolutionGetInstanceNumber(instance.instanceName);
      if (number && number !== instance.phone) {
        data.phone = number;
      }
    } catch { /* número é bônus — não falha o sync por isso */ }

    const updated = await prisma.whatsappInstance.update({
      where: { id },
      data,
    });

    return NextResponse.json({ status: updated.status, phone: updated.phone, raw: rawData });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

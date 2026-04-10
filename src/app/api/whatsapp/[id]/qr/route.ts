import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionCreateInstance, evolutionGetQR } from "@/lib/evolution";

// GET /api/whatsapp/[id]/qr
// Creates the Evolution instance if needed, then returns the QR code base64
export async function GET(
  req: NextRequest,
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

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const webhookUrl = `${origin}/api/webhook/whatsapp`;

  try {
    // Try to create the instance on Evolution (idempotent — ignore 400/409 if already exists)
    await evolutionCreateInstance(instance.instanceName, webhookUrl).catch(() => {});

    const qrData = await evolutionGetQR(instance.instanceName);

    await prisma.whatsappInstance.update({
      where: { id },
      data: { status: "CONNECTING" },
    });

    return NextResponse.json(qrData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

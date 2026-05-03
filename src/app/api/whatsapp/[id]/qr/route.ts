import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionCreateInstance, evolutionGetQR } from "@/lib/evolution";
import { assertModule } from "@/lib/billing";
import { buildWhatsappWebhookUrl } from "@/lib/webhook-auth";

// GET /api/whatsapp/[id]/qr
// Creates the Evolution instance if needed, then returns the QR code base64
export async function GET(
  req: NextRequest,
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

  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const webhookUrl = buildWhatsappWebhookUrl(origin);

  try {
    // Tenta criar a instância na Evolution (idempotente — ignora 400/409 se já existe)
    // Captura o token retornado para salvar no banco
    let savedToken: string | null = (instance as any).instanceToken ?? null;
    try {
      const createResult = await evolutionCreateInstance(instance.instanceName, webhookUrl);
      // Evolution v2 retorna o token em hash.apikey ou instance.token
      const newToken =
        createResult?.hash?.apikey ??
        createResult?.instance?.token ??
        createResult?.token ??
        null;
      if (newToken) {
        savedToken = newToken;
        await (prisma.whatsappInstance.update as any)({
          where: { id },
          data: { instanceToken: newToken },
        });
      }
    } catch {}

    const qrData = await evolutionGetQR(instance.instanceName, savedToken);

    await prisma.whatsappInstance.update({
      where: { id },
      data: { status: "CONNECTING" },
    });

    return NextResponse.json(qrData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

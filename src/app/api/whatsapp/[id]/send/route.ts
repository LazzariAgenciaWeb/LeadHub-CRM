import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionSendText } from "@/lib/evolution";

// POST /api/whatsapp/[id]/send
// Body: { phone: string, text: string }
export async function POST(
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

  const { phone, text } = await req.json();
  if (!phone || !text) {
    return NextResponse.json({ error: "phone e text são obrigatórios" }, { status: 400 });
  }

  try {
    const instanceToken = (instance as any).instanceToken as string | null | undefined;
    const result = await evolutionSendText(instance.instanceName, phone, text, instanceToken);

    // Save the sent message locally
    await prisma.message.create({
      data: {
        externalId: result?.key?.id ?? `out-${Date.now()}`,
        body: text,
        direction: "OUTBOUND",
        phone,
        instanceId: id,
        companyId: instance.companyId,
      },
    });

    // Para grupos não há lead vinculado — pular atualização de atendimento
    if (!phone.includes("@g.us")) {
      const lead = await prisma.lead.findFirst({ where: { phone, companyId: instance.companyId }, orderBy: { createdAt: "desc" } });
      if (lead && lead.attendanceStatus === "WAITING") {
        await prisma.lead.update({ where: { id: lead.id }, data: { attendanceStatus: "IN_PROGRESS" } });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

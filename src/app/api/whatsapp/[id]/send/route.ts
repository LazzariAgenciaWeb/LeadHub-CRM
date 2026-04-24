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

  const { phone, text, quotedExternalId, quotedBody, quotedFromMe } = await req.json();
  if (!phone || !text) {
    return NextResponse.json({ error: "phone e text são obrigatórios" }, { status: 400 });
  }

  const quoted = quotedExternalId
    ? { externalId: quotedExternalId, body: quotedBody ?? "", fromMe: quotedFromMe ?? false }
    : null;

  try {
    const instanceToken = (instance as any).instanceToken as string | null | undefined;
    const result = await evolutionSendText(instance.instanceName, phone, text, instanceToken, quoted);

    // Usar o remoteJid confirmado pela Evolution como phone canônico (evita conversa duplicada)
    const rawJid: string | undefined = result?.key?.remoteJid;
    const canonicalPhone = rawJid && !rawJid.includes("@g.us")
      ? rawJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
      : phone;

    // Save the sent message locally
    const saved = await prisma.message.create({
      data: {
        externalId: result?.key?.id ?? `out-${Date.now()}`,
        body: text,
        direction: "OUTBOUND",
        phone: canonicalPhone,
        instanceId: id,
        companyId: instance.companyId,
        ...(quoted ? { quotedId: quotedExternalId, quotedBody: quotedBody ?? null } : {}),
      },
      include: { instance: { select: { instanceName: true } }, campaign: { select: { id: true, name: true } } },
    });

    // Para grupos não há lead vinculado — pular atualização de atendimento
    if (!canonicalPhone.includes("@g.us")) {
      const lead = await prisma.lead.findFirst({ where: { phone: canonicalPhone, companyId: instance.companyId }, orderBy: { createdAt: "desc" } });
      if (lead && lead.attendanceStatus === "WAITING") {
        await prisma.lead.update({ where: { id: lead.id }, data: { attendanceStatus: "IN_PROGRESS" } });
      }
    }

    return NextResponse.json({ ok: true, message: saved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

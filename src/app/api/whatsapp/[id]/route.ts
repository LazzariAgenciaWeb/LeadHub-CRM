import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionDeleteInstance, evolutionSetSettings } from "@/lib/evolution";
import { assertModule } from "@/lib/billing";

// PATCH /api/whatsapp/[id]
export async function PATCH(
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

  const existing = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { instanceName, phone, status, webhookUrl, instanceToken, acceptGroups } = body;

  const instance = await (prisma.whatsappInstance.update as any)({
    where: { id },
    data: {
      ...(instanceName !== undefined  && { instanceName }),
      ...(phone !== undefined         && { phone }),
      ...(status !== undefined        && { status }),
      ...(webhookUrl !== undefined    && { webhookUrl }),
      ...(instanceToken !== undefined && { instanceToken: instanceToken || null }),
      ...(acceptGroups !== undefined  && { acceptGroups: !!acceptGroups }),
    },
  });

  // Se o toggle "aceita grupos" foi alterado, propaga pra Evolution
  // (groupsIgnore = !acceptGroups). A flag só afeta recebimento — a instância
  // continua dentro dos grupos no WhatsApp e ainda pode enviar.
  // Se a Evolution falhar, o LeadHub fica fora de sincronia até o próximo
  // "Reconfigurar webhooks" — devolvemos um warning na resposta.
  if (acceptGroups !== undefined && !!acceptGroups !== (existing as any).acceptGroups) {
    try {
      await evolutionSetSettings(
        existing.instanceName,
        { groupsIgnore: !acceptGroups },
        (existing as any).instanceToken ?? null,
      );
    } catch (err: any) {
      console.warn(`[WA PATCH] Falha ao sincronizar groupsIgnore na Evolution para ${existing.instanceName}:`, err?.message ?? err);
      return NextResponse.json({
        ...instance,
        warning: `Atualizado no LeadHub, mas a Evolution não confirmou (${err?.message ?? "erro"}). Use "Reconfigurar webhooks" pra sincronizar.`,
      });
    }
  }

  return NextResponse.json(instance);
}

// DELETE /api/whatsapp/[id]
export async function DELETE(
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

  const existing = await prisma.whatsappInstance.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Instância não encontrada" }, { status: 404 });

  if (userRole !== "SUPER_ADMIN" && existing.companyId !== userCompanyId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  // Remove from Evolution API (best effort)
  await evolutionDeleteInstance(existing.instanceName).catch(() => {});

  await prisma.whatsappInstance.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

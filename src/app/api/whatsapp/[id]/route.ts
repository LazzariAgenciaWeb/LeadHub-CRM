import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionDeleteInstance, evolutionSetSettings, evolutionSetWebhookEvents } from "@/lib/evolution";
import { buildWhatsappWebhookUrl } from "@/lib/webhook-auth";
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
  const { instanceName, phone, status, webhookUrl, instanceToken, acceptGroups, groupReceiver } = body;

  // Receptora de grupos: no máximo 1 por empresa. Ao MARCAR esta como receptora,
  // desmarca as demais da mesma empresa (regra aplicada aqui, não no banco).
  if (groupReceiver === true) {
    await prisma.whatsappInstance.updateMany({
      where: { companyId: existing.companyId, id: { not: id }, groupReceiver: true } as any,
      data: { groupReceiver: false } as any,
    });
  }

  // ── Troca do slug (instanceName) ─────────────────────────────────────────
  // O instanceName é a chave que casa mensagem↔instância em todo o sistema e
  // precisa bater EXATAMENTE com o nome da instância na Evolution. Editá-lo é
  // o que permite apontar o LeadHub pra uma instância que já existe na
  // Evolution (em vez de criar uma nova). Por ser sensível, só SUPER_ADMIN
  // pode, e validamos formato + unicidade antes de gravar.
  let slugChangedTo: string | null = null;
  if (instanceName !== undefined) {
    if (userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Apenas SUPER_ADMIN pode editar o slug da instância" }, { status: 403 });
    }
    const nextSlug = String(instanceName).trim();
    if (!nextSlug) {
      return NextResponse.json({ error: "O slug não pode ficar vazio" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(nextSlug)) {
      return NextResponse.json({ error: "Slug inválido. Use só letras, números, ponto, hífen ou underscore (sem espaço/acento)." }, { status: 400 });
    }
    if (nextSlug !== existing.instanceName) {
      const clash = await prisma.whatsappInstance.findFirst({
        where: { instanceName: nextSlug, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json({ error: `Já existe uma instância com o slug "${nextSlug}"` }, { status: 409 });
      }
      slugChangedTo = nextSlug;
    }
  }

  const instance = await (prisma.whatsappInstance.update as any)({
    where: { id },
    data: {
      ...(slugChangedTo !== null      && { instanceName: slugChangedTo }),
      ...(phone !== undefined         && { phone }),
      ...(status !== undefined        && { status }),
      ...(webhookUrl !== undefined    && { webhookUrl }),
      ...(instanceToken !== undefined && { instanceToken: instanceToken || null }),
      ...(acceptGroups !== undefined  && { acceptGroups: !!acceptGroups }),
      ...(groupReceiver !== undefined && { groupReceiver: !!groupReceiver }),
    },
  });

  // Slug apontado pra outra instância da Evolution → reconfigura o webhook
  // nela (best-effort) pra que as mensagens passem a chegar no LeadHub.
  // Se a Evolution não confirmar, não desfaz a troca — devolve um warning
  // e o admin pode usar "Reconfigurar webhooks".
  if (slugChangedTo) {
    try {
      const wbBase = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
      const wbUrl = buildWhatsappWebhookUrl(wbBase);
      await evolutionSetWebhookEvents(slugChangedTo, wbUrl, instanceToken ?? (existing as any).instanceToken ?? null);
    } catch (err: any) {
      console.warn(`[WA PATCH] Slug trocado para "${slugChangedTo}" mas falhou ao reconfigurar webhook na Evolution:`, err?.message ?? err);
      return NextResponse.json({
        ...instance,
        warning: `Slug salvo, mas a Evolution não confirmou o webhook (${err?.message ?? "erro"}). Confira se a instância "${slugChangedTo}" existe lá e use "Reconfigurar webhooks".`,
      });
    }
  }

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

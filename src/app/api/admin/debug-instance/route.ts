import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/debug-instance?phone=5088&company=ez4u
 *
 * Diagnóstico de webhook/instância: verifica se chegaram mensagens de um telefone
 * e lista a configuração das instâncias de uma empresa. Apenas SUPER_ADMIN.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const phoneQuery = searchParams.get("phone") ?? "";
  const companyQuery = searchParams.get("company") ?? "";

  // 1. Instâncias que batem com o nome da empresa
  const instances = await prisma.whatsappInstance.findMany({
    where: companyQuery
      ? { company: { name: { contains: companyQuery } } }
      : {},
    include: {
      company: { select: { id: true, name: true, triggerOnly: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // 2. Mensagens recentes para o telefone (parcial)
  const messages = phoneQuery
    ? await prisma.message.findMany({
        where: { phone: { contains: phoneQuery } },
        orderBy: { receivedAt: "desc" },
        take: 20,
        select: {
          id: true,
          phone: true,
          body: true,
          direction: true,
          receivedAt: true,
          processed: true,
          externalId: true,
          companyId: true,
          instance: { select: { instanceName: true } },
          company: { select: { name: true } },
        },
      })
    : [];

  // 3. Configuração de webhook atual da Evolution para cada instância
  const webhookChecks: Record<string, any> = {};
  try {
    const { prisma: db } = await import("@/lib/prisma");
    const settings = await db.setting.findMany({
      where: { key: { in: ["evolution_base_url", "evolution_api_key"] } },
    });
    const cfg: Record<string, string> = {};
    for (const s of settings) cfg[s.key] = s.value;
    const baseUrl = cfg["evolution_base_url"]?.replace(/\/$/, "");
    const apiKey = cfg["evolution_api_key"];

    if (baseUrl && apiKey) {
      for (const inst of instances) {
        const token = (inst as any).instanceToken ?? apiKey;
        try {
          const res = await fetch(`${baseUrl}/webhook/find/${inst.instanceName}`, {
            headers: { apikey: token },
          });
          const data = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
          webhookChecks[inst.instanceName] = data;
        } catch (e: any) {
          webhookChecks[inst.instanceName] = { error: e.message };
        }
      }
    }
  } catch {}

  return NextResponse.json({
    query: { phone: phoneQuery, company: companyQuery },
    instances: instances.map((i) => ({
      id: i.id,
      instanceName: i.instanceName,
      status: i.status,
      phone: i.phone,
      company: i.company?.name,
      triggerOnly: i.company?.triggerOnly,
      webhookConfig: webhookChecks[i.instanceName] ?? null,
    })),
    recentMessages: messages,
  });
}

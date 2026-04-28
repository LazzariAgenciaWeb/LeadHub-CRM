import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/debug-instance?phone=5088&company=ez4u
 *
 * Diagnóstico de webhook/instância. Parâmetros opcionais:
 *   phone   → filtra mensagens recentes que contenham esse trecho no telefone
 *   company → filtra instâncias cujo nome de empresa contenha esse trecho
 *             (sem esse param → lista TODAS as instâncias)
 *
 * Apenas SUPER_ADMIN.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if ((session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Apenas SUPER_ADMIN" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const phoneQuery   = searchParams.get("phone")   ?? "";
  const companyQuery = searchParams.get("company") ?? "";

  // 1. Todas as instâncias (filtradas por empresa se informado)
  const instances = await prisma.whatsappInstance.findMany({
    where: companyQuery
      ? { company: { name: { contains: companyQuery, mode: "insensitive" } } }
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
        take: 30,
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

  // 3. Configuração de webhook atual da Evolution para cada instância no banco
  const settings = await prisma.setting.findMany({
    where: { key: { in: ["evolution_base_url", "evolution_api_key"] } },
  });
  const cfg: Record<string, string> = {};
  for (const s of settings) cfg[s.key] = s.value;
  const baseUrl = cfg["evolution_base_url"]?.replace(/\/$/, "");
  const apiKey  = cfg["evolution_api_key"];

  const webhookChecks: Record<string, any> = {};
  if (baseUrl && apiKey) {
    await Promise.all(
      instances.map(async (inst) => {
        const token = (inst as any).instanceToken ?? apiKey;
        try {
          const res = await fetch(`${baseUrl}/webhook/find/${inst.instanceName}`, {
            headers: { apikey: token },
          });
          webhookChecks[inst.instanceName] = res.ok ? await res.json() : { httpStatus: res.status };
        } catch (e: any) {
          webhookChecks[inst.instanceName] = { error: e.message };
        }
      })
    );
  }

  // 4. Todas as instâncias que a Evolution conhece (para encontrar instanceName real)
  let evolutionInstances: any[] = [];
  if (baseUrl && apiKey) {
    try {
      const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
        headers: { apikey: apiKey },
      });
      if (res.ok) {
        const list: any[] = await res.json();
        evolutionInstances = list.map((i: any) => ({
          name: i.name ?? i.instanceName,
          connectionStatus: i.connectionStatus ?? i.state,
          owner: i.instance?.owner ?? i.owner ?? null,
        }));
      }
    } catch {}
  }

  return NextResponse.json({
    query: { phone: phoneQuery, company: companyQuery },

    // Instâncias cadastradas no banco (com config de webhook)
    dbInstances: instances.map((i) => ({
      id: i.id,
      instanceName: i.instanceName,
      status: i.status,
      phone: i.phone,
      company: i.company?.name,
      companyId: i.company?.id,
      triggerOnly: i.company?.triggerOnly,
      webhookAtEvolution: webhookChecks[i.instanceName] ?? null,
    })),

    // Instâncias que a Evolution conhece (para comparar nomes)
    evolutionInstances,

    // Mensagens recentes do telefone pesquisado
    recentMessages: messages,
  }, { headers: { "Content-Type": "application/json" } });
}

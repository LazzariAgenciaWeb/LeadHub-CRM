import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evolutionGetGroupName } from "@/lib/evolution";

// POST /api/whatsapp/group-name
// Body: { groupJid, companyId }
// Busca o nome do grupo na Evolution API e atualiza o CompanyContact
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { groupJid, companyId } = await req.json();
  if (!groupJid || !groupJid.includes("@g.us")) {
    return NextResponse.json({ error: "groupJid inválido" }, { status: 400 });
  }

  const effectiveCompanyId =
    (session.user as any).role === "SUPER_ADMIN"
      ? companyId
      : (session.user as any).companyId;

  if (!effectiveCompanyId) return NextResponse.json({ error: "Empresa não informada" }, { status: 400 });

  // Pegar uma instância conectada da empresa
  const instance = await prisma.whatsappInstance.findFirst({
    where: { companyId: effectiveCompanyId, status: "CONNECTED" },
  });
  if (!instance) return NextResponse.json({ error: "Nenhuma instância conectada" }, { status: 404 });

  const groupName = await evolutionGetGroupName(
    instance.instanceName,
    groupJid,
    (instance as any).instanceToken ?? null
  );

  if (!groupName) return NextResponse.json({ error: "Nome não encontrado" }, { status: 404 });

  await prisma.companyContact.upsert({
    where: { companyId_phone: { companyId: effectiveCompanyId, phone: groupJid } },
    create: { phone: groupJid, name: groupName, isGroup: true, companyId: effectiveCompanyId },
    update: { name: groupName, isGroup: true },
  });

  return NextResponse.json({ name: groupName });
}

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { previewClientes } from "@/lib/bling-sync";

// POST /api/integrations/bling/preview
//
// Dry-run: calcula o que a sincronização de CLIENTES faria (criar aqui, vincular
// por CNPJ, criar no Bling, pulados) SEM gravar nada. Serve pra revisar o
// espelho/mescla antes do 1º import. Financeiro (boletos/NF) é read-only e não
// entra no preview.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any)?.role as string;
  const sessionCompanyId = (session.user as any)?.companyId as string | undefined;
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const queryCompanyId = new URL(req.url).searchParams.get("companyId") || undefined;
  const companyId = role === "SUPER_ADMIN" ? queryCompanyId : sessionCompanyId;
  if (!companyId) {
    return NextResponse.json({ error: "Selecione a empresa (a AZZ)." }, { status: 400 });
  }

  const integ = await prisma.blingIntegration.findUnique({
    where: { companyId },
    select: { id: true },
  });
  if (!integ) {
    return NextResponse.json({ error: "Bling não conectado para esta empresa." }, { status: 400 });
  }

  try {
    const plan = await previewClientes(companyId);
    return NextResponse.json({ ok: true, plan });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Falha ao pré-visualizar" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { mergeCompany } from "@/lib/company-merge";

// POST /api/companies/[id]/merge
// Body: { targetId: string }
// Mescla a empresa [id] (origem) na empresa targetId (destino) e deleta a origem.
// Apenas SUPER_ADMIN. Usa getServerSession (sessão real) — não respeita impersonation.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id: sourceId } = await params;
  const body = await req.json().catch(() => ({}));
  const targetId = body?.targetId as string | undefined;

  if (!targetId || typeof targetId !== "string") {
    return NextResponse.json(
      { error: "targetId é obrigatório no body." },
      { status: 400 }
    );
  }
  if (targetId === sourceId) {
    return NextResponse.json(
      { error: "Empresa origem e destino são iguais." },
      { status: 400 }
    );
  }

  try {
    const result = await mergeCompany(sourceId, targetId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[POST /api/companies/[id]/merge]", err);
    return NextResponse.json(
      { error: err?.message ?? "Falha ao mesclar empresas." },
      { status: 500 }
    );
  }
}

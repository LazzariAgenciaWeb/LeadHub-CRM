import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/projetos/[id]/materiais/[materialId]/media
 *
 * Serve o binário da imagem (ProjectMaterial.mediaBase64) decodificado. A UI usa
 * como `<img src>` — o browser só baixa quando renderiza, cacheando localmente
 * (a base64 nunca vai inline nas listas).
 *
 * Acesso:
 *   • sessão logada da mesma empresa do projeto (admin/atendente), OU
 *   • `?t=<publicToken>` batendo com o publicToken do projeto (painel do cliente,
 *     que é público em /c/[token]).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; materialId: string }> },
) {
  const { id, materialId } = await params;

  const material = await prisma.projectMaterial.findUnique({
    where: { id: materialId },
    select: {
      mediaBase64: true,
      mediaType: true,
      projectId: true,
      project: { select: { publicToken: true, setor: { select: { companyId: true } } } },
    },
  });

  if (!material || material.projectId !== id) return new NextResponse("Não encontrado", { status: 404 });
  if (!material.mediaBase64) return new NextResponse("Sem mídia", { status: 404 });

  // 1) acesso público via token do painel do cliente
  const token = req.nextUrl.searchParams.get("t");
  const publicOk = !!token && !!material.project.publicToken && token === material.project.publicToken;

  // 2) senão, exige sessão da mesma empresa
  if (!publicOk) {
    const session = await getEffectiveSession();
    if (!session) return new NextResponse("Não autorizado", { status: 401 });
    const role = (session.user as any).role;
    const companyId = (session.user as any).companyId;
    if (role !== "SUPER_ADMIN" && material.project.setor.companyId !== companyId) {
      return new NextResponse("Não autorizado", { status: 403 });
    }
  }

  const buf = Buffer.from(material.mediaBase64, "base64");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": material.mediaType ?? "application/octet-stream",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

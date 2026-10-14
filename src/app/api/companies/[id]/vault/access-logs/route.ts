import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";

// GET /api/companies/[id]/vault/access-logs?limit=200
//
// Histórico de auditoria do cofre: une CredentialAccessLog (senhas) e
// SecureNoteAccessLog (notas) numa lista só, mais recente primeiro.
// Restrito a ADMIN/SUPER_ADMIN (canDelete) — auditoria serve pra fiscalizar
// o acesso, então CLIENT não vê.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canDelete) {
    return NextResponse.json({ error: "Apenas admin pode ver o histórico" }, { status: 403 });
  }

  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 200, 1), 500);

  const [credLogs, noteLogs] = await Promise.all([
    prisma.credentialAccessLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, action: true, userName: true, userRole: true,
        ipAddress: true, userAgent: true, createdAt: true,
        credential: { select: { label: true, asset: { select: { name: true } } } },
      },
    }),
    prisma.secureNoteAccessLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, action: true, userName: true, userRole: true,
        ipAddress: true, userAgent: true, createdAt: true,
        note: { select: { title: true } },
      },
    }),
  ]);

  const logs = [
    ...credLogs.map((l) => ({
      id: l.id,
      kind: "CREDENTIAL" as const,
      action: l.action,
      target: l.credential.label,
      context: l.credential.asset.name,
      userName: l.userName,
      userRole: l.userRole,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      createdAt: l.createdAt,
    })),
    ...noteLogs.map((l) => ({
      id: l.id,
      kind: "NOTE" as const,
      action: l.action,
      target: l.note.title,
      context: "Nota segura",
      userName: l.userName,
      userRole: l.userRole,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      createdAt: l.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return NextResponse.json({ logs });
}

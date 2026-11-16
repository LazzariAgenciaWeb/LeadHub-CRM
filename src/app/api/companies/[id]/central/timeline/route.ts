import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { clientRecordAccess } from "@/lib/permissions";
import { getUserPermissions } from "@/lib/user-permissions";
import { buildClientTimeline, clientCentralScope, TIMELINE_TYPES, type TimelineType } from "@/lib/client-central";

// GET /api/companies/[id]/central/timeline?types=CONTRATO,EMAIL&since=2026-01-01
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const scope = await clientCentralScope(session, id);
  if (!scope) return NextResponse.json({ error: "Sem acesso a este cliente" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const types = (sp.get("types") ?? "")
    .split(",").map((t) => t.trim().toUpperCase())
    .filter((t): t is TimelineType => (TIMELINE_TYPES as readonly string[]).includes(t));
  const sinceRaw = sp.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;

  const perms = await getUserPermissions(session);
  const events = await buildClientTimeline(id, scope.agencyId, {
    types,
    since: since && !Number.isNaN(since.getTime()) ? since : null,
    access: clientRecordAccess(session),
    viewerUserId: (session.user as any)?.id ?? null,
    emailAccountIds: perms && !perms.isAdmin ? perms.emailAccountIds : null,
    includeInternalTickets: (session.user as any)?.role === "SUPER_ADMIN",
  });
  return NextResponse.json({ events });
}

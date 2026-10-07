import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { clientIp, isInternalIp, learnInternalIp } from "@/lib/internal-ip";

// Visita nova só depois de 30 min da anterior — recarregar a página ou voltar
// do WhatsApp em seguida é a mesma visita.
const NEW_VISIT_MS = 30 * 60_000;

// POST /api/aprovar/[token]/visto
// Body: { open?: boolean, seen?: number, total?: number }
//   open  → o cliente abriu o link (conta visita e registra no histórico)
//   seen  → até qual arquivo do carrossel ele já passou (1 = só a capa)
//
// Chamado pelo navegador (JS), nunca no render: o robô de prévia do WhatsApp
// abre o link assim que a mensagem sai e marcaria "visto" sozinho.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const task = await prisma.projectTask.findUnique({
    where:  { approvalToken: token },
    select: {
      id: true, projectId: true, status: true, approvalRound: true,
      project: { select: { setor: { select: { companyId: true } } } },
      approvalViewedAt: true, approvalLastViewAt: true, approvalViewCount: true, approvalSlidesSeen: true,
    },
  });
  if (!task) return NextResponse.json({ ok: false }, { status: 404 });
  // Depois de respondida, visita não muda nada (a rodada já fechou).
  if (task.status !== "AGUARDANDO_CLIENTE") return NextResponse.json({ ok: true });

  // Acesso da EQUIPE não conta: logado na agência (ou SUPER_ADMIN) — e aí o
  // IP vira interno — ou vindo de um IP que a equipe já usou.
  const agencyId = task.project.setor.companyId;
  const ip = clientIp(req.headers);
  const session = await getServerSession(authOptions).catch(() => null);
  const role = (session?.user as any)?.role as string | undefined;
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;
  if (role === "SUPER_ADMIN" || (userCompanyId && userCompanyId === agencyId)) {
    await learnInternalIp(role === "SUPER_ADMIN" ? null : agencyId, ip, (session?.user as any)?.id ?? null);
    return NextResponse.json({ ok: true, internal: true });
  }
  if (await isInternalIp(agencyId, ip)) return NextResponse.json({ ok: true, internal: true });

  const now = new Date();
  const total = Math.max(0, Math.min(200, Math.round(Number(body?.total) || 0)));
  const seen  = Math.max(0, Math.min(total || 200, Math.round(Number(body?.seen) || 0)));
  const data: Record<string, unknown> = {};

  if (seen > task.approvalSlidesSeen) data.approvalSlidesSeen = seen;
  if (total) data.approvalSlidesTotal = total;

  let event: { type: string; toText: string } | null = null;
  if (body?.open) {
    const isNewVisit = !task.approvalLastViewAt || now.getTime() - task.approvalLastViewAt.getTime() >= NEW_VISIT_MS;
    data.approvalLastViewAt = now;
    if (ip) data.approvalLastViewIp = ip;
    if (!task.approvalViewedAt) {
      data.approvalViewedAt = now;
      data.approvalViewCount = 1;
      event = { type: "APPROVAL_VIEWED", toText: `Rodada ${task.approvalRound}${ip ? ` · IP ${ip}` : ""}` };
    } else if (isNewVisit) {
      const n = task.approvalViewCount + 1;
      data.approvalViewCount = n;
      event = { type: "APPROVAL_REVISIT", toText: `${n}ª visita · rodada ${task.approvalRound}${ip ? ` · IP ${ip}` : ""}` };
    }
  }

  if (Object.keys(data).length) {
    await prisma.projectTask.update({ where: { id: task.id }, data });
  }
  if (event) {
    await prisma.projectTaskEvent.create({
      data: { taskId: task.id, projectId: task.projectId, type: event.type, toText: event.toText, byClient: true },
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

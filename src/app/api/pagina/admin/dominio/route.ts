import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSeeBioAdmin } from "@/lib/bio-page-server";
import { bioDomainTarget } from "@/lib/bio-domain";
import {
  DomainInputError,
  loadBioDomain,
  refreshBioDomain,
  removeBioDomain,
  setBioDomain,
  setBioDomainStatusManually,
} from "@/lib/bio-domain-server";

/**
 * POST /api/pagina/admin/dominio — domínio de uma página pelo painel da agência.
 *
 * Só SUPER_ADMIN ou o ADMIN da agência dona da linha Página (canSeeBioAdmin).
 * Serve para o que o autoatendimento não resolve: cadastrar o domínio de um
 * cliente que contratou por fora, reconferir na hora e, principalmente, ATIVAR
 * À MÃO — quando o domínio já está servido por outro caminho (DNS da Cloudflare
 * no nome do cliente, por exemplo) e não há custom hostname para consultar.
 *
 * Corpo: { pageId, action: "cadastrar" | "verificar" | "ativar" | "pendente" | "remover", hostname? }
 */
export async function POST(req: NextRequest) {
  if (!(await canSeeBioAdmin())) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { pageId?: unknown; action?: unknown; hostname?: unknown }
    | null;
  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  const action = String(body?.action ?? "");
  if (!pageId) return NextResponse.json({ error: "Informe a página." }, { status: 400 });

  const page = await prisma.bioPage.findUnique({ where: { id: pageId }, select: { companyId: true } });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  try {
    switch (action) {
      case "cadastrar": {
        const domain = await setBioDomain(pageId, page.companyId, String(body?.hostname ?? ""), { asAdmin: true });
        return NextResponse.json({ domain, target: bioDomainTarget() });
      }
      case "verificar":
        return NextResponse.json({ domain: await refreshBioDomain(pageId), target: bioDomainTarget() });
      case "ativar":
        return NextResponse.json({
          domain: await setBioDomainStatusManually(pageId, "ACTIVE", null),
          target: bioDomainTarget(),
        });
      case "pendente":
        return NextResponse.json({
          domain: await setBioDomainStatusManually(pageId, "PENDING", "Aguardando o apontamento do DNS."),
          target: bioDomainTarget(),
        });
      case "remover":
        await removeBioDomain(pageId);
        return NextResponse.json({ domain: null, target: bioDomainTarget() });
      default:
        return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof DomainInputError) {
      return NextResponse.json({ error: e.message, problem: e.problem, suggestion: e.suggestion }, { status: 400 });
    }
    throw e;
  }
}

/** GET /api/pagina/admin/dominio?pageId=… — situação atual. */
export async function GET(req: NextRequest) {
  if (!(await canSeeBioAdmin())) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const pageId = req.nextUrl.searchParams.get("pageId") ?? "";
  if (!pageId) return NextResponse.json({ error: "Informe a página." }, { status: 400 });
  return NextResponse.json({ domain: await loadBioDomain(pageId), target: bioDomainTarget() });
}

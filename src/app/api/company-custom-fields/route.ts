import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

// Campos personalizados aplicados a EMPRESAS. Espelha /api/custom-fields
// (que é pra Lead). A definição pertence ao "ownerCompanyId" (o tenant),
// e os mesmos campos aparecem em todas as sub-empresas desse owner.
//
// Resolução do owner ao listar/editar campos de uma empresa-alvo:
//   owner = target.parentCompanyId ?? target.id
// Assim a agência (parent) define uma vez e todos os clientes (filhos) herdam.

const VALID_TYPES = new Set(["TEXT", "NUMBER", "DATE", "SELECT", "LINK"]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Resolve o ownerCompanyId a partir do `targetCompanyId` (a empresa que está sendo vista). */
async function resolveOwner(targetCompanyId: string): Promise<string | null> {
  const target = await prisma.company.findUnique({
    where: { id: targetCompanyId },
    select: { id: true, parentCompanyId: true },
  });
  if (!target) return null;
  return target.parentCompanyId ?? target.id;
}

// GET /api/company-custom-fields?companyId=<targetId>
// → retorna os defs do owner da target (parent ou ela mesma).
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const targetCompanyId = req.nextUrl.searchParams.get("companyId");
  if (!targetCompanyId) {
    return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  }

  const ownerCompanyId = await resolveOwner(targetCompanyId);
  if (!ownerCompanyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  // Acesso: SUPER_ADMIN tudo. Demais: precisa ser do owner OU da target.
  if (role !== "SUPER_ADMIN" && userCompanyId !== ownerCompanyId && userCompanyId !== targetCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const defs = await prisma.companyCustomFieldDef.findMany({
    where: { ownerCompanyId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ ownerCompanyId, defs });
}

// POST /api/company-custom-fields { companyId, name, type, options? }
// `companyId` aqui é a target (empresa vista). O def é criado no owner dela.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const body = await req.json();

  const targetCompanyId = String(body.companyId ?? "");
  const name: string = (body.name ?? "").trim();
  const type: string = (body.type ?? "TEXT").toUpperCase();
  const options = Array.isArray(body.options)
    ? body.options.map((o: unknown) => String(o).trim()).filter(Boolean)
    : [];

  if (!targetCompanyId) return NextResponse.json({ error: "companyId obrigatório" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (!VALID_TYPES.has(type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  if (type === "SELECT" && options.length === 0) {
    return NextResponse.json({ error: "Tipo SELECT precisa de pelo menos uma opção" }, { status: 400 });
  }

  const ownerCompanyId = await resolveOwner(targetCompanyId);
  if (!ownerCompanyId) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });

  if (role !== "SUPER_ADMIN" && userCompanyId !== ownerCompanyId && userCompanyId !== targetCompanyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const baseKey = slugify(name) || "campo";
  let key = baseKey;
  let suffix = 1;
  while (await prisma.companyCustomFieldDef.findUnique({ where: { ownerCompanyId_key: { ownerCompanyId, key } } })) {
    suffix += 1;
    key = `${baseKey}_${suffix}`;
  }

  const last = await prisma.companyCustomFieldDef.findFirst({
    where: { ownerCompanyId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const def = await prisma.companyCustomFieldDef.create({
    data: {
      name,
      key,
      type: type as any,
      options: type === "SELECT" ? options : null,
      order: (last?.order ?? -1) + 1,
      ownerCompanyId,
    },
  });

  return NextResponse.json(def, { status: 201 });
}

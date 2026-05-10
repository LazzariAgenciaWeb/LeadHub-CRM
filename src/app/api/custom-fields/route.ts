import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = new Set(["TEXT", "NUMBER", "DATE", "SELECT"]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// GET /api/custom-fields?companyId=  → defs da empresa
export async function GET(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const queryCompanyId = req.nextUrl.searchParams.get("companyId") ?? undefined;

  let companyId: string | undefined;
  if (role === "SUPER_ADMIN") {
    if (!queryCompanyId) {
      return NextResponse.json({ error: "companyId obrigatório para SUPER_ADMIN" }, { status: 400 });
    }
    companyId = queryCompanyId;
  } else {
    companyId = userCompanyId;
  }
  if (!companyId) return NextResponse.json([]);

  const defs = await prisma.customFieldDef.findMany({
    where: { companyId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(defs);
}

// POST /api/custom-fields { name, type, options?, required?, companyId? }
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const body = await req.json();

  const name: string = (body.name ?? "").trim();
  const type: string = (body.type ?? "TEXT").toUpperCase();
  const options = Array.isArray(body.options) ? body.options.map((o: unknown) => String(o)).filter(Boolean) : [];
  const required: boolean = !!body.required;

  if (!name) return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  if (!VALID_TYPES.has(type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  if (type === "SELECT" && options.length === 0) {
    return NextResponse.json({ error: "Tipo SELECT precisa de pelo menos uma opção" }, { status: 400 });
  }

  let companyId: string | undefined;
  if (role === "SUPER_ADMIN") {
    companyId = body.companyId;
    if (!companyId) {
      return NextResponse.json({ error: "companyId obrigatório para SUPER_ADMIN" }, { status: 400 });
    }
  } else {
    companyId = userCompanyId;
  }
  if (!companyId) return NextResponse.json({ error: "Sem empresa" }, { status: 400 });

  // Gera key única dentro da empresa (slug + sufixo se colidir)
  const baseKey = slugify(name) || "campo";
  let key = baseKey;
  let suffix = 1;
  while (await prisma.customFieldDef.findUnique({ where: { companyId_key: { companyId, key } } })) {
    suffix += 1;
    key = `${baseKey}_${suffix}`;
  }

  const last = await prisma.customFieldDef.findFirst({
    where: { companyId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const def = await prisma.customFieldDef.create({
    data: {
      name,
      key,
      type: type as any,
      options: type === "SELECT" ? options : null,
      required,
      order: (last?.order ?? -1) + 1,
      companyId,
    },
  });

  return NextResponse.json(def, { status: 201 });
}

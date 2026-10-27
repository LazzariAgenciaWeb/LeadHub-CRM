import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bioSlugProblem } from "@/lib/bio-page";
import { requireBioEditor } from "@/lib/bio-page-server";

// GET /api/pagina/endereco?slug=… — o editor confere o endereço enquanto o
// dono digita. A palavra final é do PUT (corrida entre duas abas, etc.).
export async function GET(req: NextRequest) {
  const auth = await requireBioEditor();
  if (!auth.ok) return auth.response;

  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  const problem = bioSlugProblem(slug);
  if (problem) return NextResponse.json({ available: false, problem });

  const taken = await prisma.bioPage.findFirst({
    where: { slug, NOT: { companyId: auth.companyId } },
    select: { id: true },
  });
  return NextResponse.json({ available: !taken, problem: taken ? "em-uso" : null });
}

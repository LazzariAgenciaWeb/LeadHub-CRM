import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { assertModule } from "@/lib/billing";

const KINDS = ["DOCUMENTO", "REUNIAO", "APOIO", "LINK", "ANEXO", "INLINE"];
const MAX_IMG_BYTES = 4 * 1024 * 1024; // 4 MB por print (base64 no DB)

// Carrega o projeto e confere que pertence à empresa da sessão.
async function ownedProject(id: string, session: any) {
  const role          = (session.user as any).role as string;
  const userCompanyId = (session.user as any).companyId as string | undefined;
  const project = await prisma.setorClickupList.findUnique({
    where: { id },
    select: { id: true, setor: { select: { companyId: true } } },
  });
  if (!project) return { error: NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 }) };
  if (role !== "SUPER_ADMIN" && project.setor.companyId !== userCompanyId) {
    return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const };
}

// POST /api/projetos/[id]/materiais — adiciona material (opcionalmente a uma tarefa)
// Body: { kind, taskId?, stage?, title, docHtml?, url?, ata?, order? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const gate = await assertModule(session, "projetos");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const owned = await ownedProject(id, session);
  if ("error" in owned) return owned.error;

  const body = await req.json();
  const { kind, taskId, stage, title, docHtml, url, ata, order, featured, mediaBase64, mediaType } = body;
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind inválido" }, { status: 400 });
  }
  // INLINE (print embutido no descritivo) não exige título — geramos um.
  const isInline = kind === "INLINE";
  if (!isInline && (typeof title !== "string" || !title.trim())) {
    return NextResponse.json({ error: "título obrigatório" }, { status: 400 });
  }

  // Imagem embutida: aceita data URL ("data:image/png;base64,…") ou base64 cru.
  let cleanBase64: string | null = null;
  let cleanMime: string | null = null;
  if (mediaBase64 && typeof mediaBase64 === "string") {
    const m = mediaBase64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    cleanBase64 = m ? m[2] : mediaBase64;
    cleanMime = (m ? m[1] : (typeof mediaType === "string" ? mediaType : "")) || null;
    if (!cleanMime || !cleanMime.startsWith("image/")) {
      return NextResponse.json({ error: "Só imagens são aceitas" }, { status: 400 });
    }
    // Buffer.byteLength do base64 ≈ tamanho decodificado.
    if (Buffer.byteLength(cleanBase64, "base64") > MAX_IMG_BYTES) {
      return NextResponse.json({ error: "Imagem grande demais (máx. 4 MB)" }, { status: 413 });
    }
  } else if (isInline) {
    return NextResponse.json({ error: "mediaBase64 obrigatório pra imagem inline" }, { status: 400 });
  }

  // Se veio taskId, a tarefa precisa ser deste projeto.
  if (taskId) {
    const task = await prisma.projectTask.findUnique({ where: { id: taskId }, select: { projectId: true } });
    if (!task || task.projectId !== id) {
      return NextResponse.json({ error: "Tarefa inválida" }, { status: 400 });
    }
  }

  const material = await prisma.projectMaterial.create({
    data: {
      projectId: id,
      taskId:  taskId || null,
      kind,
      stage:   typeof stage === "string" && stage.trim() ? stage.trim() : null,
      title:   (typeof title === "string" && title.trim()) ? title.trim() : "Print",
      docHtml: typeof docHtml === "string" && docHtml.trim() ? docHtml : null,
      url:     typeof url === "string" && url.trim() ? url.trim() : null,
      ata:     typeof ata === "string" && ata.trim() ? ata : null,
      featured: !!featured,
      order:   Number.isInteger(order) ? order : 0,
      mediaBase64: cleanBase64,
      mediaType:   cleanMime,
    },
    select: { id: true, kind: true, title: true, url: true, mediaType: true },
  });
  return NextResponse.json(material, { status: 201 });
}

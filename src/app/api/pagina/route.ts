import { NextRequest, NextResponse } from "next/server";
import { parseBioEditorInput } from "@/lib/bio-page";
import {
  SlugTakenError,
  ensureBioPage,
  loadEditorPage,
  requireBioEditor,
  saveBioPage,
  toEditorInput,
} from "@/lib/bio-page-server";

// GET /api/pagina — página da empresa da sessão (cria o rascunho na 1ª vez).
export async function GET() {
  const auth = await requireBioEditor();
  if (!auth.ok) return auth.response;
  await ensureBioPage(auth.companyId);
  return NextResponse.json({ page: toEditorInput(await loadEditorPage(auth.companyId)) });
}

// PUT /api/pagina — salva a página inteira (dados, itens, perguntas, publicação).
export async function PUT(req: NextRequest) {
  const auth = await requireBioEditor();
  if (!auth.ok) return auth.response;

  const parsed = parseBioEditorInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const pageId = await ensureBioPage(auth.companyId);
  try {
    await saveBioPage(pageId, parsed.data);
  } catch (e) {
    if (e instanceof SlugTakenError) {
      return NextResponse.json({ error: "Esse endereço já está em uso. Escolha outro." }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ page: toEditorInput(await loadEditorPage(auth.companyId)) });
}

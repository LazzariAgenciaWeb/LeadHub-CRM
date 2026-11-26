import { NextRequest, NextResponse } from "next/server";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import { extractIp, recordAdminAction } from "@/lib/admin-audit";
import { CpanelError, uploadCpanelFiles } from "@/lib/cpanel";

// POST /api/companies/[id]/cpanel/upload — multipart:
//   files (1..50), subPath (subpasta dentro da pasta de publicação), overwrite ("1" troca o que já existe)
// Sem overwrite, arquivo existente volta com exists=true e a tela pergunta antes de substituir.
// Mesmo recorte da config: ADMIN / SUPER_ADMIN. Todo envio vai pro AdminAuditLog.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const auth = await authorizeVaultAccess(companyId, { checkCofreModule: false });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.canDelete) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  const subPath = String(form.get("subPath") ?? "");
  const overwrite = form.get("overwrite") === "1";

  try {
    const out = await uploadCpanelFiles(companyId, {
      subPath,
      overwrite,
      files: files.map((f) => ({ name: f.name, data: f })),
    });
    const sent = out.results.filter((r) => r.ok).map((r) => r.file);
    if (sent.length) {
      await recordAdminAction({
        adminUserId: auth.userId, adminUserName: auth.userName,
        action: "CPANEL_UPLOAD", targetCompanyId: companyId,
        ip: extractIp(req), userAgent: req.headers.get("user-agent"),
        metadata: { dir: out.dir, files: sent, overwrite, origem: "tela" },
      });
    }
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof CpanelError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[cpanel/upload]", e instanceof Error ? e.message : "erro");
    return NextResponse.json({ error: "Falha inesperada ao enviar pro cPanel." }, { status: 500 });
  }
}

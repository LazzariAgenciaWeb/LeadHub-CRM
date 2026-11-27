import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { extractIp, recordAdminAction } from "@/lib/admin-audit";
import { CpanelError, uploadCpanelFiles } from "@/lib/cpanel";

// POST /api/meu-espaco/upload — o cliente envia arquivos pro PRÓPRIO site.
// Mesmo multipart da rota da agência (files, subPath, overwrite="1").
// Travas: empresa vem da sessão; só empresa-cliente com `clientCanUpload`;
// tudo fica dentro da pasta de publicação (resolveCpanelPath) e vai pra auditoria.
export async function POST(req: NextRequest) {
  const session = await getEffectiveSession();
  const u = session?.user as { id?: string; name?: string; email?: string; role?: string; companyId?: string } | undefined;
  if (!u?.id || !u.companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (u.role === "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const company = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: { parentCompanyId: true, cpanelIntegration: { select: { clientCanUpload: true } } },
  });
  if (!company?.parentCompanyId || !company.cpanelIntegration?.clientCanUpload) {
    return NextResponse.json({ error: "Não liberado para a sua conta." }, { status: 403 });
  }

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
    const out = await uploadCpanelFiles(u.companyId, {
      subPath, overwrite, files: files.map((f) => ({ name: f.name, data: f })),
    });
    const sent = out.results.filter((r) => r.ok).map((r) => r.file);
    if (sent.length) {
      await recordAdminAction({
        adminUserId: u.id, adminUserName: u.name ?? u.email ?? "?", adminUserEmail: u.email ?? null,
        action: "CPANEL_UPLOAD", targetCompanyId: u.companyId,
        ip: extractIp(req), userAgent: req.headers.get("user-agent"),
        metadata: { dir: out.dir, files: sent, overwrite, origem: "meu-espaco" },
      });
    }
    // O cliente não vê o caminho no servidor, só a subpasta e os links.
    return NextResponse.json({ ok: true, subPath: out.subPath, results: out.results });
  } catch (e) {
    if (e instanceof CpanelError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[meu-espaco/upload]", e instanceof Error ? e.message : "erro");
    return NextResponse.json({ error: "Não foi possível enviar agora. Tente de novo em instantes." }, { status: 500 });
  }
}

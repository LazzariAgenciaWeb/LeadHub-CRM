import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { storageEnabled } from "@/lib/storage/s3";
import { ensureBioPage, loadEditorPage, toEditorInput } from "@/lib/bio-page-server";
import { BIO_PUBLIC_PATH, bioDefaultConsent } from "@/lib/bio-page";
import { prisma } from "@/lib/prisma";
import PaginaEditor from "./PaginaEditor";

// Editor da Página do Negócio. Cria o rascunho na primeira visita.

export const dynamic = "force-dynamic";

export default async function PaginaPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  const role = (session.user as any)?.role as string | undefined;
  const companyId = (session.user as any)?.companyId as string | undefined;

  if (!companyId) {
    return (
      <div className="p-6">
        <h1 className="text-white font-bold text-xl">Página do Negócio</h1>
        <p className="text-slate-400 text-sm mt-2">
          A página é de cada empresa. Use &quot;Visualizar como cliente&quot; na empresa para editar a página dela.
        </p>
      </div>
    );
  }
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") redirect("/dashboard");
  const gate = await assertModule(session, "paginaNegocio");
  if (!gate.ok) redirect("/dashboard");

  await ensureBioPage(companyId);
  const [page, company] = await Promise.all([
    loadEditorPage(companyId),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, tradeName: true } }),
  ]);

  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  return (
    <PaginaEditor
      initial={toEditorInput(page)}
      publicBase={`${base}${BIO_PUBLIC_PATH}/`}
      uploadsEnabled={storageEnabled()}
      defaultConsent={bioDefaultConsent(company.tradeName ?? company.name)}
      hasBottomNav={!(session.user as any)?.pageOnly}
    />
  );
}

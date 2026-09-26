import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LIBRARY_ITEM_SELECT } from "@/lib/client-library";
import ArquivosBiblioteca, { type LibItem } from "./ArquivosBiblioteca";

export const dynamic = "force-dynamic";

// Meu Espaço → Arquivos: biblioteca que a agência monta pro cliente
// (logos, artes, links do Drive, vídeos, materiais). Só leitura aqui.
export default async function ArquivosPage() {
  const session = await getEffectiveSession();
  const companyId = (session?.user as any)?.companyId as string | undefined;
  const role = (session?.user as any)?.role as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") redirect("/dashboard");
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { parentCompanyId: true } });
  if (!company?.parentCompanyId) redirect("/dashboard");

  const rows = await prisma.clientLibraryItem.findMany({
    where:   { clientCompanyId: companyId, visibleToClient: true },
    orderBy: [{ folder: "asc" }, { createdAt: "desc" }],
    select:  LIBRARY_ITEM_SELECT,
  });
  const items: LibItem[] = rows
    .filter((r) => r.kind !== "FILE" || r.storageObject?.status === "READY")
    .map((r) => ({
      id: r.id,
      folder: r.folder,
      kind: r.kind === "FILE" ? "FILE" : "LINK",
      title: r.title,
      description: r.description,
      url: r.url,
      createdAt: r.createdAt.toISOString(),
      file: r.storageObject
        ? { id: r.storageObject.id, fileName: r.storageObject.fileName, mimeType: r.storageObject.mimeType, size: r.storageObject.size }
        : null,
    }));

  return (
    <div>
      <Link href="/meu-espaco" style={{ fontSize: 13, fontWeight: 600, color: "#727A8C", textDecoration: "none" }}>← Voltar</Link>
      <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: "#F3F5FA" }}>Arquivos</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, color: "#AFB6C6" }}>
        Logos, artes, vídeos e materiais que produzimos pra você — pra baixar quando precisar.
      </p>
      <ArquivosBiblioteca items={items} />
    </div>
  );
}

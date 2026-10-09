import { prisma } from "@/lib/prisma";
import SuperAdminCompanyPicker from "./SuperAdminCompanyPicker";

/**
 * Tela "selecione o cliente" — mostrada no lugar do conteúdo quando o
 * SUPER_ADMIN abre uma tela que só faz sentido dentro de UMA empresa
 * (relatórios, chamados, projetos, e-mail, Instagram...). Escolher um cliente
 * inicia a impersonação e volta pra mesma tela já como ADMIN daquele cliente.
 *
 * Uso no server component: `if (role === "SUPER_ADMIN") return <SuperAdminCompanyGate title="Chamados" />;`
 * (quando impersonando, getEffectiveSession devolve role ADMIN e o gate não aparece).
 */
export default async function SuperAdminCompanyGate({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const companies = await prisma.company.findMany({
    where: { hasSystemAccess: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentCompany: { select: { name: true } } },
  });

  return (
    <div className="p-6">
      <h1 className="text-white font-bold text-xl mb-1">{title}</h1>
      <p className="text-slate-500 text-sm mb-6">
        {description ?? "Esta tela mostra os dados de uma empresa por vez. Selecione o cliente para continuar."}
      </p>
      <SuperAdminCompanyPicker
        companies={companies.map((c) => ({ id: c.id, name: c.name, parentName: c.parentCompany?.name ?? null }))}
      />
    </div>
  );
}

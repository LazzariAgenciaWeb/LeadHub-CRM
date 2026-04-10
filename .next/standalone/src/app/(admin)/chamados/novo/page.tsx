import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import NewTicketForm from "./NewTicketForm";

const CATEGORIES = [
  "Acesso / Login",
  "Relatórios",
  "Integração WhatsApp",
  "Campanhas",
  "Faturamento",
  "Bug / Erro",
  "Dúvida",
  "Outro",
];

export default async function NewTicketPage() {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const companies = isSuperAdmin
    ? await prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-white font-bold text-xl">Novo Chamado</h1>
        <p className="text-slate-500 text-sm mt-0.5">Abra um chamado de suporte</p>
      </div>
      <NewTicketForm
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        defaultCompanyId={userCompanyId ?? ""}
        categories={CATEGORIES}
      />
    </div>
  );
}

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

  // Empresas-agência (só super admin escolhe)
  const companies = isSuperAdmin
    ? await prisma.company.findMany({
        where: { OR: [{ parentCompanyId: null }, { hasSystemAccess: true }] },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const effectiveCompanyId = isSuperAdmin
    ? (companies[0]?.id ?? "")
    : (userCompanyId ?? "");

  // Buscas paralelas pra preencher os pickers do form
  const [users, setores, clients] = await Promise.all([
    // Usuários da empresa-agência (atendentes)
    effectiveCompanyId
      ? prisma.user.findMany({
          where: { companyId: effectiveCompanyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Setores da empresa-agência
    effectiveCompanyId
      ? prisma.setor.findMany({
          where: { companyId: effectiveCompanyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Clientes (sub-empresas) que pertencem à agência
    effectiveCompanyId
      ? prisma.company.findMany({
          where: { parentCompanyId: effectiveCompanyId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-white font-bold text-xl">Novo Chamado / Tarefa</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Abra um chamado de cliente ou crie uma tarefa interna
        </p>
      </div>
      <NewTicketForm
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        defaultCompanyId={effectiveCompanyId}
        categories={CATEGORIES}
        users={users}
        setores={setores}
        clients={clients}
      />
    </div>
  );
}

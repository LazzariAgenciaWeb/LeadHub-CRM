import { getEffectiveSession } from "@/lib/effective-session";


import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import TicketDetail from "./TicketDetail";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getEffectiveSession();
  const isSuperAdmin = (session?.user as any)?.role === "SUPER_ADMIN";
  const userCompanyId = (session?.user as any)?.companyId as string | undefined;

  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) notFound();

  if (!isSuperAdmin && ticket.companyId !== userCompanyId) notFound();

  return (
    <TicketDetail
      ticket={ticket as any}
      isSuperAdmin={isSuperAdmin}
      currentUserName={session?.user?.name ?? "Usuário"}
    />
  );
}

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import EmpresasClient from "./EmpresasClient";

export default async function EmpresasPage() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "SUPER_ADMIN") redirect("/dashboard");

  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { leads: true, campaigns: true, whatsappInstances: true },
      },
    },
  });

  return <EmpresasClient companies={companies as any} />;
}

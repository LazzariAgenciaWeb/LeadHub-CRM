import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import CuponsClient from "./CuponsClient";

// Gestão de cupons promocionais — só SUPER_ADMIN.
export default async function CuponsPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session) redirect("/login");
  if (role !== "SUPER_ADMIN") redirect("/dashboard");

  return <CuponsClient />;
}

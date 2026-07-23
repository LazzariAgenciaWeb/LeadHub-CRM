import { redirect } from "next/navigation";
import { getEffectiveSession } from "@/lib/effective-session";
import FeatureLocked from "@/components/FeatureLocked";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Tela de upsell pra um módulo não contratado. O Sidebar aponta os itens
// bloqueados (esmaecidos + cadeado) pra cá em vez de esconder.
export default async function UpgradePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  const companyId = (session.user as any).companyId as string | undefined;
  return <FeatureLocked module={module} companyId={companyId} />;
}

import { redirect } from "next/navigation";
import LayoutShell from "@/components/LayoutShell";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { getEffectiveSession, isImpersonating } from "@/lib/effective-session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getEffectiveSession();

  if (!session) {
    redirect("/login");
  }

  const impersonating = isImpersonating(session);
  const impersonatedCompany = (session as any)._impersonating;

  const banner =
    impersonating && impersonatedCompany ? (
      <ImpersonationBanner companyName={impersonatedCompany.companyName} />
    ) : null;

  return (
    <LayoutShell session={session} banner={banner}>
      {children}
    </LayoutShell>
  );
}

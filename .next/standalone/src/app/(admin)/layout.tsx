import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
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

  return (
    <div className="flex h-screen bg-[#080b12] overflow-hidden">
      <Sidebar session={session} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {impersonating && impersonatedCompany && (
          <ImpersonationBanner companyName={impersonatedCompany.companyName} />
        )}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

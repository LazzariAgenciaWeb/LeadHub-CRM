import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import CompanyEmailConfigForm from "./CompanyEmailConfigForm";
import EmailTemplatesSection from "./EmailTemplatesSection";
import EmailCampaignsSection from "./EmailCampaignsSection";

export const dynamic = "force-dynamic";

export default async function EmailMarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");

  const gate = await assertModule(session, "emailMarketing");
  if (!gate.ok) {
    return (
      <div className="p-6">
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-8 text-center max-w-lg mx-auto">
          <div className="text-4xl mb-3">📧</div>
          <h1 className="text-white font-bold text-lg mb-1">E-mail Marketing</h1>
          <p className="text-slate-500 text-sm">
            Módulo não habilitado para esta empresa. Fale com o administrador para liberar.
          </p>
        </div>
      </div>
    );
  }

  const isSuperAdmin = (session.user as any)?.role === "SUPER_ADMIN";
  const sp = await searchParams;
  const companyId = isSuperAdmin
    ? (sp.companyId ?? (session.user as any).companyId)
    : (session.user as any).companyId;

  // Indicador: SMTP configurado?
  const smtp = companyId
    ? await prisma.companyEmailConfig.findUnique({
        where: { companyId },
        select: { host: true, verified: true },
      })
    : null;
  const smtpConfigured = !!smtp?.host;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl">📧 E-mail Marketing</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Configure seu servidor, crie templates e dispare campanhas pros leads.
          </p>
        </div>
        <Link href="/campanhas" className="text-slate-500 hover:text-white text-xs">
          ← Campanhas de link
        </Link>
      </div>

      {/* SMTP — collapsado se já configurado e verificado, expandido caso contrário */}
      <details open={!smtp?.verified} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl group/details">
        <summary className="px-5 py-3 cursor-pointer flex items-center justify-between list-none">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-sm">⚙️ Servidor de e-mail (SMTP)</span>
            {smtp?.verified ? (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-green-500/20 text-green-400 border-green-500/40">Verificado</span>
            ) : smtpConfigured ? (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-amber-500/20 text-amber-400 border-amber-500/40">Não testado</span>
            ) : (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/40">Não configurado</span>
            )}
          </div>
          <span className="text-slate-600 text-xs group-open/details:hidden">Expandir</span>
          <span className="text-slate-600 text-xs hidden group-open/details:inline">Recolher</span>
        </summary>
        <div className="border-t border-[#1e2d45] p-5">
          <CompanyEmailConfigForm companyId={isSuperAdmin ? companyId : undefined} />
        </div>
      </details>

      {/* Templates */}
      <EmailTemplatesSection companyId={isSuperAdmin ? companyId : undefined} />

      {/* Campanhas */}
      <EmailCampaignsSection companyId={isSuperAdmin ? companyId : undefined} />

      <p className="text-slate-600 text-xs">
        ⚠️ Comece com volumes pequenos (50-100/dia) e cresça gradual — domínio novo sem
        histórico pode cair em spam. Configure SPF/DKIM no DNS do seu domínio pra melhor entrega.
      </p>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { canSeeBioAdmin } from "@/lib/bio-page-server";
import { getAdminOverview } from "@/lib/bio-page-stats";
import { BIO_PUBLIC_PATH } from "@/lib/bio-page";

// Painel da agência: todas as Páginas do Negócio com números de 30 dias.
// O cliente do grátis vê só os totais dele; o detalhe mora aqui.

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default async function PaginasAdminPage() {
  if (!(await canSeeBioAdmin())) redirect("/dashboard");
  const pages = await getAdminOverview();

  const totals = pages.reduce(
    (t, p) => ({ views: t.views + p.views30, leads: t.leads + p.leads30, referrals: t.referrals + p.referrals }),
    { views: 0, leads: 0, referrals: 0 },
  );
  const published = pages.filter((p) => p.published).length;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-white font-bold text-xl">Páginas dos clientes</h1>
      <p className="text-slate-500 text-sm mt-0.5">Todas as Páginas do Negócio — números dos últimos 30 dias.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {[
          ["Páginas", `${pages.length}`, `${published} publicadas`],
          ["Visitas", totals.views.toLocaleString("pt-BR"), "30 dias"],
          ["Contatos", totals.leads.toLocaleString("pt-BR"), "30 dias"],
          ["Cadastros pelo selo", totals.referrals.toLocaleString("pt-BR"), "desde o início"],
        ].map(([label, value, hint]) => (
          <div key={label} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-3">
            <div className="text-slate-500 text-[11px]">{label}</div>
            <div className="text-white text-xl font-bold">{value}</div>
            <div className="text-slate-600 text-[11px]">{hint}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-[#1e2d45]">
              <th className="px-3 py-2.5 font-semibold">Empresa</th>
              <th className="px-3 py-2.5 font-semibold">Plano</th>
              <th className="px-3 py-2.5 font-semibold text-right">Visitas</th>
              <th className="px-3 py-2.5 font-semibold text-right">Contatos</th>
              <th className="px-3 py-2.5 font-semibold text-right">Total</th>
              <th className="px-3 py-2.5 font-semibold text-right">Indicou</th>
              <th className="px-3 py-2.5 font-semibold">Criada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e2d45]">
            {pages.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Nenhuma página ainda.</td></tr>
            )}
            {pages.map((p) => (
              <tr key={p.id} className="hover:bg-[#131c2c]">
                <td className="px-3 py-2.5">
                  <Link href={`/pagina/admin/${p.id}`} className="text-white font-medium hover:text-indigo-300">{p.company}</Link>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className={p.published ? "text-emerald-400" : ""}>{p.published ? "no ar" : "rascunho"}</span>
                    {p.published && (
                      <a href={`${BIO_PUBLIC_PATH}/${p.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-white">
                        /p/{p.slug} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {p.referredBy && <span>· veio de /p/{p.referredBy}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-300 text-xs">{p.plan ?? "—"}</td>
                <td className="px-3 py-2.5 text-right text-slate-200">{p.views30}</td>
                <td className="px-3 py-2.5 text-right text-slate-200">{p.leads30}</td>
                <td className="px-3 py-2.5 text-right text-slate-400">{p.leadsAll}</td>
                <td className="px-3 py-2.5 text-right text-slate-400">{p.referrals}</td>
                <td className="px-3 py-2.5 text-slate-500 text-xs">{DATE.format(new Date(p.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

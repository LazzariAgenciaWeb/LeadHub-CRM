"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface ClickEvent {
  id: string;
  targetUrl: string;
  targetLabel: string | null;
  createdAt: string;
}

interface TrackingLink {
  id: string;
  code: string;
  label: string | null;
  destination: string;
  destType: string;
  clicks: number;
  createdAt: string;
  campaignId: string | null;
  companyId: string | null;
  campaign: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  _count: { leads: number; clickEvents: number };
  clickEvents: ClickEvent[];
}

interface Campaign { id: string; name: string; companyId: string }
interface Company { id: string; name: string; phone: string | null }

export default function LinksManager({
  isSuperAdmin, initialLinks, campaigns, companies, defaultCompanyId, baseUrl,
  totalClicks, totalLeads, clicksByDay, clicksByLink,
}: {
  isSuperAdmin: boolean;
  initialLinks: TrackingLink[];
  campaigns: Campaign[];
  companies: Company[];
  defaultCompanyId?: string;
  baseUrl: string;
  totalClicks: number;
  totalLeads: number;
  clicksByDay: { date: string; internos: number }[];
  clicksByLink: { label: string; cliques: number; internos: number }[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [filter, setFilter] = useState<"all" | "organic" | "campaign">("all");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedDest, setCopiedDest] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"links" | "report">("links");
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [showPixelInfo, setShowPixelInfo] = useState(false);
  const [copiedPixel, setCopiedPixel] = useState(false);
  const [showOgFields, setShowOgFields] = useState(false);
  const [destType, setDestType] = useState<"url" | "whatsapp">("url");
  const [linkType, setLinkType] = useState<"organic" | "campaign">("organic");

  const defaultCompany = companies.find(c => c.id === defaultCompanyId) ?? companies[0];

  const [form, setForm] = useState({
    label: "",
    destination: "",
    companyId: defaultCompanyId ?? companies[0]?.id ?? "",
    campaignId: campaigns[0]?.id ?? "",
    waPhone: defaultCompany?.phone ?? "",
    waMessage: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
  });

  function buildDestination() {
    if (destType === "whatsapp") {
      const phone = form.waPhone.replace(/\D/g, "");
      const msg = encodeURIComponent(form.waMessage);
      return `https://wa.me/${phone}?text=${msg}`;
    }
    return form.destination;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const destination = buildDestination();
    if (!destination) return;
    setSaving(true);
    const body: any = {
      destination,
      label: form.label || null,
      destType,
      waMessage: destType === "whatsapp" ? form.waMessage : undefined,
      ogTitle: form.ogTitle || undefined,
      ogDescription: form.ogDescription || undefined,
      ogImage: form.ogImage || undefined,
    };
    if (linkType === "campaign") {
      body.campaignId = form.campaignId;
    } else {
      body.companyId = form.companyId;
    }
    const res = await fetch("/api/tracking-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const link = await res.json();
      setLinks((prev) => [link, ...prev]);
      setForm({ ...form, label: "", destination: "", waMessage: "", ogTitle: "", ogDescription: "", ogImage: "" });
      setShowOgFields(false);
      setShowForm(false);
      router.refresh();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este link? Os cliques serão perdidos.")) return;
    setDeleting(id);
    await fetch(`/api/tracking-links/${id}`, { method: "DELETE" });
    setLinks((prev) => prev.filter((l) => l.id !== id));
    setDeleting(null);
    router.refresh();
  }

  function copyLink(code: string) {
    navigator.clipboard.writeText(`${baseUrl}/r/${code}`);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = links.filter((l) => {
    if (filter === "organic") return !l.campaignId;
    if (filter === "campaign") return !!l.campaignId;
    return true;
  });

  const filteredClicks = filtered.reduce((s, l) => s + l.clicks, 0);
  const filteredLeads = filtered.reduce((s, l) => s + l._count.leads, 0);

  function handleCompanyChange(companyId: string) {
    const company = companies.find(c => c.id === companyId);
    setForm({ ...form, companyId, waPhone: company?.phone ?? "" });
  }

  const pixelSnippet = `<script src="${baseUrl}/pixel/${defaultCompanyId ?? companies[0]?.id}.js" async></script>`;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl">Links de Rastreamento</h1>
          <p className="text-slate-500 text-sm mt-0.5">Gerencie links de campanha e links orgânicos (bio, site, etc.)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#0f1623] border border-[#1e2d45] rounded-lg p-0.5">
            <button onClick={() => setActiveTab("links")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === "links" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
              🔗 Links
            </button>
            <button onClick={() => setActiveTab("report")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === "report" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>
              📊 Relatório
            </button>
          </div>
          {activeTab === "links" && (
            <button onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors">
              {showForm ? "Cancelar" : "+ Novo Link"}
            </button>
          )}
        </div>
      </div>

      {/* ───── ABA RELATÓRIO ───── */}
      {activeTab === "report" && (
        <div className="space-y-6">
          {/* Área: cliques internos por dia */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">
              Cliques internos por dia <span className="text-slate-500 font-normal text-xs">(últimos 30 dias)</span>
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={clicksByDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradInternos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }} itemStyle={{ color: "#f59e0b" }} />
                <Area type="monotone" dataKey="internos" name="Cliques internos" stroke="#f59e0b" strokeWidth={2} fill="url(#gradInternos)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Barras: cliques por link */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">
              Cliques por link <span className="text-slate-500 font-normal text-xs">(top 10)</span>
            </h3>
            {clicksByLink.every(l => l.cliques === 0 && l.internos === 0) ? (
              <div className="text-center text-slate-500 text-sm py-10">Nenhum clique registrado ainda.</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, clicksByLink.length * 44)}>
                <BarChart data={clicksByLink} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={130} />
                  <Tooltip contentStyle={{ background: "#0f1623", border: "1px solid #1e2d45", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#64748b", paddingTop: 8 }} />
                  <Bar dataKey="cliques" name="Visitas (cliques no link)" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} />
                  <Bar dataKey="internos" name="Cliques internos no site" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabela resumo */}
          <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#1e2d45]">
              <h3 className="text-white font-semibold text-sm">Resumo por link</h3>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e2d45]">
                  <th className="text-left text-slate-500 font-medium px-5 py-2.5">Link</th>
                  <th className="text-right text-slate-500 font-medium px-4 py-2.5">Visitas</th>
                  <th className="text-right text-slate-500 font-medium px-4 py-2.5">Internos</th>
                  <th className="text-right text-slate-500 font-medium px-4 py-2.5">Leads</th>
                  <th className="text-right text-slate-500 font-medium px-4 py-2.5">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link, idx) => {
                  const conv = link.clicks > 0 ? ((link._count.leads / link.clicks) * 100).toFixed(0) : "-";
                  return (
                    <tr key={link.id} className={idx % 2 === 0 ? "bg-white/[0.01]" : ""}>
                      <td className="px-5 py-2.5">
                        <span className="text-white font-medium">{link.label ?? link.code}</span>
                        {link.campaign
                          ? <span className="text-indigo-400 text-[10px] ml-2">📣 {link.campaign.name}</span>
                          : <span className="text-amber-400 text-[10px] ml-2">🌱</span>}
                      </td>
                      <td className="text-right text-slate-300 px-4 py-2.5">{link.clicks}</td>
                      <td className="text-right text-amber-400 px-4 py-2.5">{link._count.clickEvents}</td>
                      <td className="text-right text-green-400 px-4 py-2.5">{link._count.leads}</td>
                      <td className="text-right text-indigo-400 px-4 py-2.5">{conv}{conv !== "-" ? "%" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── ABA LINKS ───── */}
      {activeTab === "links" && (
        <div>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-1">Total Links</div>
              <div className="text-2xl font-bold text-white">{links.length}</div>
            </div>
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-1">Cliques</div>
              <div className="text-2xl font-bold text-white">{totalClicks}</div>
            </div>
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4">
              <div className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-1">Leads gerados</div>
              <div className="text-2xl font-bold text-green-400">{totalLeads}</div>
            </div>
          </div>

          {/* Pixel de rastreamento */}
          <div className="mb-5">
            <button type="button" onClick={() => setShowPixelInfo(!showPixelInfo)}
              className="text-xs text-slate-500 hover:text-indigo-400 transition-colors flex items-center gap-1.5">
              {showPixelInfo ? "▾" : "▸"} <span className="text-indigo-400 font-mono">{"</>"}</span> Instalar rastreamento no site (para monitorar cliques internos)
            </button>
            {showPixelInfo && (
              <div className="mt-3 bg-[#0a0f1a] border border-indigo-500/20 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-slate-300 text-xs font-semibold mb-1">1. Cole este script no <code className="text-indigo-400">&lt;head&gt;</code> do seu site:</p>
                  <div className="relative">
                    <pre className="bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 pt-3 pb-12 text-indigo-300 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
{pixelSnippet}
                    </pre>
                    <div className="absolute bottom-3 right-3">
                      <button onClick={() => { navigator.clipboard.writeText(pixelSnippet); setCopiedPixel(true); setTimeout(() => setCopiedPixel(false), 2000); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${copiedPixel ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/40"}`}>
                        {copiedPixel ? "✓ Copiado!" : "📋 Copiar código"}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-slate-500 text-[11px] space-y-1">
                  <p>2. Após instalar, cada vez que um visitante que chegou via link LeadHub clicar em qualquer link da página, o clique será registrado aqui.</p>
                  <p>3. O rastreamento funciona automaticamente usando o <code className="text-slate-400">utm_content</code> que é adicionado na URL.</p>
                </div>
              </div>
            )}
          </div>

          {/* Formulário novo link */}
          {showForm && (
            <form onSubmit={handleCreate} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mb-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Novo Link</h3>

              <div className="flex gap-2">
                <button type="button" onClick={() => setLinkType("organic")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${linkType === "organic" ? "bg-amber-600 text-white" : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                  🌱 Orgânico / Bio
                </button>
                <button type="button" onClick={() => setLinkType("campaign")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${linkType === "campaign" ? "bg-indigo-600 text-white" : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                  📣 Campanha
                </button>
              </div>

              {linkType === "organic" ? (
                isSuperAdmin && (
                  <div>
                    <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Empresa</label>
                    <select value={form.companyId} onChange={(e) => handleCompanyChange(e.target.value)}
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )
              ) : (
                <div>
                  <label className="text-slate-400 text-xs font-semibold uppercase tracking-wide block mb-1.5">Campanha</label>
                  <select value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Nome do link (ex: Bio Instagram, Botão Site, Anúncio Google)"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />

              <div className="flex gap-2">
                <button type="button" onClick={() => setDestType("url")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${destType === "url" ? "bg-indigo-600 text-white" : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                  🌐 URL / Site
                </button>
                <button type="button" onClick={() => setDestType("whatsapp")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${destType === "whatsapp" ? "bg-green-600 text-white" : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                  💬 WhatsApp
                </button>
              </div>

              {destType === "url" ? (
                <input type="url" required value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}
                  placeholder="https://seusite.com"
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
              ) : (
                <div className="space-y-2">
                  <input type="text" required value={form.waPhone} onChange={(e) => setForm({ ...form, waPhone: e.target.value })}
                    placeholder="Número com DDI (ex: 5511999999999)"
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                  <textarea rows={2} value={form.waMessage} onChange={(e) => setForm({ ...form, waMessage: e.target.value })}
                    placeholder="Mensagem pré-preenchida (ex: Olá! Vim pelo Instagram e quero saber mais)"
                    className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
                  {linkType === "campaign" && form.waMessage && (
                    <p className="text-indigo-400 text-[10px]">⚡ Esta mensagem será adicionada como gatilho da campanha automaticamente.</p>
                  )}
                </div>
              )}

              {/* Preview OG */}
              <div>
                <button type="button" onClick={() => setShowOgFields(!showOgFields)}
                  className="text-xs text-slate-500 hover:text-indigo-400 transition-colors flex items-center gap-1">
                  {showOgFields ? "▾" : "▸"} Personalizar preview (WhatsApp / redes sociais)
                </button>
                {showOgFields && (
                  <div className="mt-3 space-y-2 border border-[#1e2d45] rounded-lg p-3 bg-[#080b12]">
                    <p className="text-slate-500 text-[10px]">Esses dados aparecem quando o link é compartilhado no WhatsApp, Instagram, etc.</p>
                    <input type="text" value={form.ogTitle} onChange={(e) => setForm({ ...form, ogTitle: e.target.value })}
                      placeholder="Título (ex: Site Azz Agência — Criação de Sites)"
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                    <textarea rows={2} value={form.ogDescription} onChange={(e) => setForm({ ...form, ogDescription: e.target.value })}
                      placeholder="Descrição (ex: Somos especialistas em criação de sites e marketing digital...)"
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
                    <input type="url" value={form.ogImage} onChange={(e) => setForm({ ...form, ogImage: e.target.value })}
                      placeholder="URL da imagem (1200×630px recomendado)"
                      className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" />
                    {form.ogImage && (
                      <img src={form.ogImage} alt="preview" className="w-full h-32 object-cover rounded-lg border border-[#1e2d45]"
                        onError={(e) => (e.currentTarget.style.display = "none")} />
                    )}
                  </div>
                )}
              </div>

              <button type="submit" disabled={saving}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors">
                {saving ? "Gerando..." : "🔗 Gerar Link"}
              </button>
            </form>
          )}

          {/* Filtros */}
          <div className="flex items-center gap-2 mb-4">
            {([["all", "Todos"], ["organic", "🌱 Orgânico"], ["campaign", "📣 Campanha"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === val ? "bg-indigo-600 text-white" : "bg-[#0f1623] border border-[#1e2d45] text-slate-400 hover:text-white"}`}>
                {label}
              </button>
            ))}
            {filter !== "all" && (
              <span className="text-slate-500 text-xs ml-2">{filteredClicks} cliques · {filteredLeads} leads</span>
            )}
          </div>

          {/* Lista */}
          {filtered.length === 0 ? (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
              <div className="text-3xl mb-2">🔗</div>
              <div className="text-slate-500 text-sm">Nenhum link encontrado.</div>
            </div>
          ) : (
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
              {filtered.map((link, idx) => {
                const convRate = link.clicks > 0 ? ((link._count.leads / link.clicks) * 100).toFixed(0) : "0";
                const isExpanded = expandedLink === link.id;
                return (
                  <div key={link.id} className={idx < filtered.length - 1 ? "border-b border-[#1e2d45]/50" : ""}>
                    <div className="flex items-start gap-3 p-4 hover:bg-white/[0.015] transition-colors">
                      {/* Icon */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#161f30] flex items-center justify-center text-sm mt-0.5">
                        {link.destType === "whatsapp" ? "💬" : "🌐"}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {link.label && <span className="text-white text-[13px] font-semibold">{link.label}</span>}
                          {link.campaign
                            ? <span className="text-indigo-400 text-[10px] bg-indigo-500/10 px-1.5 py-0.5 rounded font-medium">📣 {link.campaign.name}</span>
                            : <span className="text-amber-400 text-[10px] bg-amber-500/10 px-1.5 py-0.5 rounded font-medium">🌱 Orgânico</span>}
                          {isSuperAdmin && link.company && (
                            <span className="text-slate-500 text-[10px]">{link.company.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-indigo-300 text-[11px] font-mono bg-indigo-500/10 px-2 py-0.5 rounded">/r/{link.code}</code>
                          <button onClick={() => copyLink(link.code)} className="text-[11px] text-slate-500 hover:text-indigo-400 transition-colors">
                            {copied === link.code ? "✓ Copiado!" : "Copiar"}
                          </button>
                        </div>
                        <div className="text-slate-600 text-[10px] truncate max-w-[320px]" title={link.destination}>
                          → {link.destination}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex-shrink-0 text-right">
                        <div className="flex items-center gap-3 mb-1">
                          <div className="text-center">
                            <div className="text-white font-bold text-sm">{link.clicks}</div>
                            <div className="text-slate-600 text-[10px]">cliques</div>
                          </div>
                          <div className="text-center">
                            <div className="text-amber-400 font-bold text-sm">{link._count.clickEvents}</div>
                            <div className="text-slate-600 text-[10px]">internos</div>
                          </div>
                          <div className="text-center">
                            <div className="text-green-400 font-bold text-sm">{link._count.leads}</div>
                            <div className="text-slate-600 text-[10px]">leads</div>
                          </div>
                          {link.clicks > 0 && (
                            <div className="text-center">
                              <div className="text-indigo-400 font-bold text-sm">{convRate}%</div>
                              <div className="text-slate-600 text-[10px]">conv.</div>
                            </div>
                          )}
                        </div>
                        <div className="flex justify-end gap-1">
                          {link._count.clickEvents > 0 && (
                            <button onClick={() => setExpandedLink(isExpanded ? null : link.id)}
                              className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-[10px] hover:bg-amber-500/20 transition-colors">
                              {isExpanded ? "▴ Fechar" : "▾ Internos"}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(link.destination);
                              setCopiedDest(link.id);
                              setTimeout(() => setCopiedDest(null), 2000);
                            }}
                            className="px-2 py-1 rounded bg-slate-500/10 text-slate-400 text-[10px] hover:bg-slate-500/20 transition-colors"
                            title="Copiar URL original (sem registrar clique)"
                          >
                            {copiedDest === link.id ? "✓ Copiado!" : "🔗 URL original"}
                          </button>
                          <button onClick={() => handleDelete(link.id)} disabled={deleting === link.id}
                            className="px-2 py-1 rounded bg-white/5 text-slate-600 text-[10px] hover:text-red-400 transition-colors">
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Cliques internos expandido */}
                    {isExpanded && link.clickEvents.length > 0 && (
                      <div className="border-t border-[#1e2d45]/50 bg-[#080b12] px-4 py-3">
                        <p className="text-amber-400 text-[10px] font-semibold uppercase tracking-wide mb-2">
                          Cliques internos ({link._count.clickEvents}) — mais recentes primeiro
                        </p>
                        <div className="space-y-0">
                          {[...link.clickEvents]
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map((ev, i) => {
                              const dt = new Date(ev.createdAt);
                              const date = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
                              const time = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                              const isWa = ev.targetLabel?.startsWith("WhatsApp");
                              return (
                                <div key={ev.id} className={`flex items-start gap-3 py-2 ${i < link.clickEvents.length - 1 ? "border-b border-[#1e2d45]/30" : ""}`}>
                                  {/* Ícone */}
                                  <span className="flex-shrink-0 text-sm mt-0.5">{isWa ? "💬" : "🖱️"}</span>
                                  {/* Info */}
                                  <div className="flex-1 min-w-0">
                                    {ev.targetLabel && (
                                      <p className={`text-[11px] font-medium leading-tight ${isWa ? "text-green-400" : "text-slate-200"}`}>
                                        {ev.targetLabel}
                                      </p>
                                    )}
                                    {ev.targetUrl && ev.targetUrl !== window?.location?.href && (
                                      <p className="text-slate-600 text-[10px] truncate max-w-[380px] mt-0.5">{ev.targetUrl}</p>
                                    )}
                                  </div>
                                  {/* Data e hora */}
                                  <div className="flex-shrink-0 text-right">
                                    <p className="text-amber-400 text-[11px] font-mono">{time}</p>
                                    <p className="text-slate-600 text-[10px]">{date}</p>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

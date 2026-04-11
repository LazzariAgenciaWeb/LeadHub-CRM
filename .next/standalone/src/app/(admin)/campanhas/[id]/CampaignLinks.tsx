"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TrackingLink {
  id: string;
  code: string;
  label: string | null;
  destination: string;
  destType: string;
  clicks: number;
  createdAt: string;
  _count: { leads: number };
}

export default function CampaignLinks({
  campaignId,
  campaignName,
  campaignSlug,
  companyPhone,
  baseUrl,
  initialLinks,
}: {
  campaignId: string;
  campaignName: string;
  campaignSlug: string;
  companyPhone: string | null;
  baseUrl: string;
  initialLinks: TrackingLink[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState<TrackingLink[]>(initialLinks);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [destType, setDestType] = useState<"url" | "whatsapp">("url");
  const [form, setForm] = useState({
    label: "",
    destination: "",
    waPhone: companyPhone ?? "",
    waMessage: `Olá! Vi sobre ${campaignName} e quero mais informações.`,
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
    const res = await fetch("/api/tracking-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        destination,
        label: form.label || null,
        destType,
        waMessage: destType === "whatsapp" ? form.waMessage : undefined,
      }),
    });

    if (res.ok) {
      const link = await res.json();
      setLinks((prev) => [link, ...prev]);
      setForm({ ...form, label: "", destination: "" });
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

  function copyUtm(link: TrackingLink) {
    const url = `${baseUrl}/r/${link.code}`;
    navigator.clipboard.writeText(url);
    setCopied(`utm-${link.code}`);
    setTimeout(() => setCopied(null), 2000);
  }

  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  const totalLeads = links.reduce((s, l) => s + l._count.leads, 0);

  return (
    <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#1e2d45]">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-sm">🔗 Links de Rastreamento</h3>
          {links.length > 0 && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-slate-400">👆 <strong className="text-white">{totalClicks}</strong> cliques</span>
              <span className="text-slate-400">🎯 <strong className="text-green-400">{totalLeads}</strong> leads</span>
            </div>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-0.5">
          Gere links rastreados para WhatsApp ou sites. Cada clique é contabilizado e cruzado com leads gerados.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleCreate} className="p-4 border-b border-[#1e2d45] space-y-3">
        {/* Tipo de destino */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDestType("url")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              destType === "url"
                ? "bg-indigo-600 text-white"
                : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"
            }`}
          >
            🌐 URL / Site
          </button>
          <button
            type="button"
            onClick={() => setDestType("whatsapp")}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              destType === "whatsapp"
                ? "bg-green-600 text-white"
                : "bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white"
            }`}
          >
            💬 WhatsApp
          </button>
        </div>

        {/* Label */}
        <input
          type="text"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Nome do link (ex: Bio Instagram, Anúncio Maio)"
          className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />

        {/* Campos por tipo */}
        {destType === "url" ? (
          <div>
            <input
              type="url"
              required
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
              placeholder="https://seusite.com/landing"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-slate-600 text-[10px] mt-1">
              UTMs serão adicionados automaticamente: <code className="text-indigo-400">utm_campaign={campaignSlug}&utm_content=[code]</code>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              required={destType === "whatsapp"}
              value={form.waPhone}
              onChange={(e) => setForm({ ...form, waPhone: e.target.value })}
              placeholder="Número com DDI (ex: 5511999999999)"
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <textarea
              rows={2}
              value={form.waMessage}
              onChange={(e) => setForm({ ...form, waMessage: e.target.value })}
              placeholder="Mensagem pré-preenchida no WhatsApp..."
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <p className="text-slate-600 text-[10px]">
              Ao clicar, o WhatsApp abre com esta mensagem pré-preenchida. Combine com gatilhos de palavras-chave para identificar o lead automaticamente.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {saving ? "Gerando..." : "🔗 Gerar Link"}
        </button>
      </form>

      {/* Links list */}
      {links.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-2xl mb-2">🔗</div>
          <div className="text-slate-500 text-sm">Nenhum link gerado ainda.</div>
        </div>
      ) : (
        <div>
          {links.map((link, idx) => {
            const shortUrl = `${baseUrl}/r/${link.code}`;
            const convRate = link.clicks > 0
              ? ((link._count.leads / link.clicks) * 100).toFixed(0)
              : "0";

            return (
              <div
                key={link.id}
                className={`p-4 ${idx < links.length - 1 ? "border-b border-[#1e2d45]/50" : ""} hover:bg-white/[0.015] transition-colors`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-sm mt-0.5">
                    {link.destType === "whatsapp" ? "💬" : "🌐"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {link.label && (
                      <div className="text-white text-[13px] font-semibold mb-0.5">{link.label}</div>
                    )}

                    {/* Short URL */}
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-indigo-300 text-[12px] font-mono bg-indigo-500/10 px-2 py-0.5 rounded">
                        /r/{link.code}
                      </code>
                      <button
                        onClick={() => copyLink(link.code)}
                        className="text-[11px] text-slate-500 hover:text-indigo-400 transition-colors"
                      >
                        {copied === link.code ? "✓ Copiado!" : "Copiar"}
                      </button>
                    </div>

                    {/* Destination preview */}
                    <div className="text-slate-600 text-[10px] truncate max-w-[280px]" title={link.destination}>
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
                      <button
                        onClick={() => copyLink(link.code)}
                        className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 text-[10px] hover:bg-indigo-500/20 transition-colors"
                      >
                        📋 Copiar link
                      </button>
                      <button
                        onClick={() => handleDelete(link.id)}
                        disabled={deleting === link.id}
                        className="px-2 py-1 rounded bg-white/5 text-slate-600 text-[10px] hover:text-red-400 transition-colors"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Instance {
  id: string;
  instanceName: string;
  phone: string | null;
  status: "CONNECTED" | "DISCONNECTED" | "CONNECTING";
  webhookUrl: string | null;
  instanceToken: string | null;
  createdAt: string;
  company: { id: string; name: string } | null;
  _count: { messages: number };
}

const STATUS_CONFIG = {
  CONNECTED: { label: "Conectado", color: "text-green-400 bg-green-500/15", dot: "bg-green-400" },
  DISCONNECTED: { label: "Desconectado", color: "text-red-400 bg-red-500/10", dot: "bg-red-400" },
  CONNECTING: { label: "Conectando", color: "text-yellow-400 bg-yellow-500/15", dot: "bg-yellow-400 animate-pulse" },
};

export default function InstancesSection({
  instances,
  isSuperAdmin,
  companies,
  defaultCompanyId,
  webhookBaseUrl,
}: {
  instances: Instance[];
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  defaultCompanyId: string;
  webhookBaseUrl: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  // Editar número (phone) da instância
  const [editingPhone, setEditingPhone] = useState<string | null>(null); // instanceId
  const [phoneInput, setPhoneInput] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [form, setForm] = useState({ instanceName: "", phone: "", companyId: defaultCompanyId });

  // QR Modal
  const [qrModal, setQrModal] = useState<{ instanceId: string; instanceName: string } | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const webhookUrl = `${webhookBaseUrl}/api/webhook/whatsapp`;

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, webhookUrl }),
    });
    setSaving(false);
    if (res.ok) {
      setShowForm(false);
      setForm({ instanceName: "", phone: "", companyId: defaultCompanyId });
      router.refresh();
    }
  }

  async function handleDelete(inst: Instance) {
    if (!confirm(`Remover instância "${inst.instanceName}"? O número será desconectado da Evolution API.`)) return;
    setDeleting(inst.id);
    await fetch(`/api/whatsapp/${inst.id}`, { method: "DELETE" });
    setDeleting(null);
    router.refresh();
  }

  async function handleSync(inst: Instance) {
    setSyncing(inst.id);
    await fetch(`/api/whatsapp/${inst.id}/sync`, { method: "POST" });
    setSyncing(null);
    router.refresh();
  }

  async function handleSaveToken(inst: Instance) {
    await fetch(`/api/whatsapp/${inst.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceToken: tokenInput }),
    });
    setEditingToken(null);
    setTokenInput("");
    router.refresh();
  }

  async function handleSavePhone(instId: string) {
    setSavingPhone(true);
    await fetch(`/api/whatsapp/${instId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneInput.trim() || null }),
    });
    setSavingPhone(false);
    setEditingPhone(null);
    setPhoneInput("");
    router.refresh();
  }

  async function handleClearPhone(instId: string) {
    setSavingPhone(true);
    await fetch(`/api/whatsapp/${instId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: null }),
    });
    setSavingPhone(false);
    setEditingPhone(null);
    setPhoneInput("");
    router.refresh();
  }

  async function openQR(inst: Instance) {
    setQrModal({ instanceId: inst.id, instanceName: inst.instanceName });
    setQrBase64(null);
    setQrError(null);
    setQrLoading(true);
    const res = await fetch(`/api/whatsapp/${inst.id}/qr`);
    const data = await res.json();
    setQrLoading(false);
    if (!res.ok) {
      setQrError(data.error ?? "Erro ao obter QR code");
    } else {
      const b64 = data.base64 ?? data.qrcode?.base64 ?? data.code;
      setQrBase64(b64 ?? null);
      if (!b64) setQrError("QR code não disponível. Tente novamente em alguns segundos.");
    }
  }

  async function refreshQR() {
    if (!qrModal) return;
    setQrBase64(null);
    setQrError(null);
    setQrLoading(true);
    const res = await fetch(`/api/whatsapp/${qrModal.instanceId}/qr`);
    const data = await res.json();
    setQrLoading(false);
    if (!res.ok) {
      setQrError(data.error ?? "Erro ao obter QR code");
    } else {
      const b64 = data.base64 ?? data.qrcode?.base64 ?? data.code;
      setQrBase64(b64 ?? null);
      if (!b64) setQrError("QR code não disponível. Tente novamente em alguns segundos.");
    }
  }

  return (
    <div className="p-6">
      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0d1525] border border-[#1e2d45] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold">Conectar WhatsApp</h2>
                <p className="text-slate-500 text-xs mt-0.5">{qrModal.instanceName}</p>
              </div>
              <button onClick={() => setQrModal(null)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-4 flex flex-col items-center justify-center min-h-[260px]">
              {qrLoading && (
                <div className="flex flex-col items-center gap-3 text-slate-400 text-sm">
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
                  Gerando QR code...
                </div>
              )}
              {!qrLoading && qrError && (
                <div className="text-center">
                  <div className="text-red-400 text-sm mb-3">{qrError}</div>
                  <button onClick={refreshQR} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors">
                    Tentar novamente
                  </button>
                </div>
              )}
              {!qrLoading && qrBase64 && (
                <img
                  src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code"
                  className="w-52 h-52 rounded-lg"
                />
              )}
            </div>
            <p className="text-slate-500 text-xs text-center mt-3">
              Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={refreshQR} disabled={qrLoading} className="flex-1 px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 text-sm hover:text-white disabled:opacity-50 transition-colors">
                🔄 Atualizar QR
              </button>
              <button
                onClick={() => {
                  const inst = instances.find((i) => i.id === qrModal.instanceId);
                  setQrModal(null);
                  if (inst) handleSync(inst);
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-500 transition-colors"
              >
                ✓ Já escaneei
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white font-bold text-lg">💬 Instâncias WhatsApp</h2>
          <p className="text-slate-500 text-sm mt-0.5">Números conectados via Evolution API</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 transition-colors"
        >
          + Nova Instância
        </button>
      </div>

      {/* Webhook URL */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-xl flex-shrink-0 mt-0.5">🔗</span>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm mb-1">URL do Webhook</div>
            <div className="text-slate-400 text-xs mb-2">
              Configure na Evolution API com o evento <code className="text-indigo-400">messages.upsert</code>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-[#0f1623] border border-[#1e2d45] rounded-lg px-3 py-2 text-indigo-300 text-xs font-mono truncate">
                {webhookUrl}
              </code>
              <button
                onClick={() => copyToClipboard(webhookUrl, "webhook")}
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-indigo-500/15 text-indigo-400 text-xs hover:bg-indigo-500/25 transition-colors"
              >
                {copied === "webhook" ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New instance form */}
      {showForm && (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-bold text-sm">Nova Instância</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
          </div>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1.5">Nome da Instância *</label>
              <input
                type="text"
                required
                value={form.instanceName}
                onChange={(e) => setForm({ ...form, instanceName: e.target.value })}
                placeholder="ex: bella-vida-whatsapp"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-slate-600 text-[10px] mt-1">Será criado automaticamente na Evolution API</p>
            </div>
            <div>
              <label className="block text-slate-400 text-xs font-medium mb-1.5">Telefone (opcional)</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="5511999999999"
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            {isSuperAdmin && (
              <div className="col-span-2">
                <label className="block text-slate-400 text-xs font-medium mb-1.5">Empresa</label>
                <select
                  value={form.companyId}
                  onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                  className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Selecione uma empresa</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-[#161f30] text-slate-400 text-sm border border-[#1e2d45] hover:text-white transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 transition-colors">
                {saving ? "Salvando..." : "Adicionar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Instances list */}
      {instances.length === 0 ? (
        <div className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">💬</div>
          <div className="text-white font-semibold mb-2">Nenhuma instância configurada</div>
          <p className="text-slate-500 text-sm mb-4">Adicione uma instância para começar a receber mensagens.</p>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 transition-colors">
            + Adicionar instância
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {instances.map((inst) => {
            const sc = STATUS_CONFIG[inst.status] ?? STATUS_CONFIG.DISCONNECTED;
            return (
              <div key={inst.id} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-11 h-11 rounded-full bg-green-500/10 flex items-center justify-center text-2xl">
                    💬
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-white font-semibold">{inst.instanceName}</span>
                      <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${sc.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      {inst.phone && <span>📱 {inst.phone}</span>}
                      {isSuperAdmin && inst.company && <span>🏢 {inst.company.name}</span>}
                      <span>💬 {inst._count.messages} msg{inst._count.messages !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Sync */}
                    <button
                      onClick={() => handleSync(inst)}
                      disabled={syncing === inst.id}
                      title="Verificar conexão"
                      className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors disabled:opacity-50"
                    >
                      {syncing === inst.id ? "..." : "🔄"}
                    </button>

                    {/* Connect QR */}
                    {inst.status !== "CONNECTED" ? (
                      <button
                        onClick={() => openQR(inst)}
                        className="px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30 text-xs font-medium transition-colors"
                      >
                        📱 Conectar
                      </button>
                    ) : (
                      <button
                        onClick={() => openQR(inst)}
                        className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors"
                      >
                        📱 Reconectar
                      </button>
                    )}

                    {/* Copy name */}
                    <button
                      onClick={() => copyToClipboard(inst.instanceName, inst.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 hover:text-white text-xs transition-colors"
                    >
                      {copied === inst.id ? "✓ Copiado" : "📋 Copiar nome"}
                    </button>

                    {/* Token da instância */}
                    <button
                      onClick={() => { setEditingToken(inst.id); setTokenInput(inst.instanceToken ?? ""); }}
                      title={inst.instanceToken ? "Token configurado ✓" : "Configurar token da instância"}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${inst.instanceToken ? "bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20" : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"}`}
                    >
                      🔑 {inst.instanceToken ? "Token ✓" : "Token"}
                    </button>

                    {/* Editar número */}
                    <button
                      onClick={() => { setEditingPhone(inst.id); setPhoneInput(inst.phone ?? ""); }}
                      title={inst.phone ? `Número: ${inst.phone} — clique para editar` : "Definir número desta instância"}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${inst.phone ? "bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20" : "bg-[#161f30] border-[#1e2d45] text-slate-500 hover:text-slate-300"}`}
                    >
                      📱 {inst.phone ? "Número ✓" : "Número"}
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(inst)}
                      disabled={deleting === inst.id}
                      title="Remover instância"
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {/* Painel de token */}
                {editingToken === inst.id && (
                  <div className="mt-3 pt-3 border-t border-[#1e2d45]">
                    <p className="text-slate-500 text-xs mb-2">
                      Cole o token da instância <strong className="text-slate-300">{inst.instanceName}</strong> da Evolution API (ícone de olho 👁 na instância).
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target.value)}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <button onClick={() => handleSaveToken(inst)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-500 transition-colors">
                        Salvar
                      </button>
                      <button onClick={() => setEditingToken(null)} className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Painel de editar número */}
                {editingPhone === inst.id && (
                  <div className="mt-3 pt-3 border-t border-[#1e2d45]">
                    <p className="text-slate-500 text-xs mb-2">
                      Edite ou remova o número associado à instância <strong className="text-slate-300">{inst.instanceName}</strong>.
                      {inst.phone && (
                        <span className="text-yellow-400"> Atual: {inst.phone}</span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={phoneInput}
                        onChange={e => setPhoneInput(e.target.value)}
                        placeholder="5511999999999 (deixe vazio para remover)"
                        className="flex-1 bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <button
                        onClick={() => handleSavePhone(inst.id)}
                        disabled={savingPhone}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-500 disabled:opacity-50 transition-colors"
                      >
                        {savingPhone ? "..." : "Salvar"}
                      </button>
                      {inst.phone && (
                        <button
                          onClick={() => handleClearPhone(inst.id)}
                          disabled={savingPhone}
                          title="Remover número desta instância"
                          className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                        >
                          🗑 Remover
                        </button>
                      )}
                      <button onClick={() => setEditingPhone(null)} className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* How to connect guide */}
      <div className="mt-6 bg-[#0f1623] border border-[#1e2d45] rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-3">🚀 Como conectar um número</h3>
        <ol className="space-y-2 text-slate-400 text-sm">
          <li className="flex gap-2"><span className="text-indigo-400 font-bold flex-shrink-0">1.</span>Clique em <strong className="text-slate-300">+ Nova Instância</strong> e dê um nome único para o número.</li>
          <li className="flex gap-2"><span className="text-indigo-400 font-bold flex-shrink-0">2.</span>Clique em <strong className="text-slate-300">📱 Conectar</strong> — o QR code será gerado automaticamente.</li>
          <li className="flex gap-2"><span className="text-indigo-400 font-bold flex-shrink-0">3.</span>No celular: WhatsApp → <em>Dispositivos conectados</em> → <em>Conectar dispositivo</em> → escaneie.</li>
          <li className="flex gap-2"><span className="text-indigo-400 font-bold flex-shrink-0">4.</span>Clique em <strong className="text-slate-300">✓ Já escaneei</strong> para confirmar. O status mudará para <span className="text-green-400">Conectado</span>.</li>
          <li className="flex gap-2"><span className="text-indigo-400 font-bold flex-shrink-0">5.</span>Mensagens recebidas aparecerão em <strong className="text-slate-300">📥 Mensagens</strong> no menu.</li>
        </ol>
      </div>
    </div>
  );
}

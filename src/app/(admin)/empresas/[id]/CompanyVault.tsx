"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Globe, Server, Layout, Mail, Database, Network, GitBranch,
  Share2, BarChart3, Cloud, Box, Lock, Eye, EyeOff, Copy,
  Plus, Trash2, Pencil, ExternalLink, AlertTriangle, Check,
  KeyRound, ShieldCheck, Info, ChevronDown, ChevronRight,
} from "lucide-react";
import VaultVerifyModal from "./VaultVerifyModal";

type AssetType =
  | "DOMAIN" | "HOSTING" | "WEBSITE" | "EMAIL_ACCOUNT" | "DATABASE"
  | "DNS_PROVIDER" | "REPOSITORY" | "SOCIAL_ACCOUNT" | "ANALYTICS"
  | "CLOUD_SERVICE" | "OTHER";

type AssetStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "ARCHIVED";

interface Credential {
  id: string;
  label: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  lastRotatedAt: string | null;
  sharedWithClient: boolean;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Asset {
  id: string;
  type: AssetType;
  name: string;
  url: string | null;
  host: string | null;
  identifier: string | null;
  provider: string | null;
  status: AssetStatus;
  expiresAt: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  credentials: Credential[];
}

const TYPE_META: Record<AssetType, { label: string; Icon: typeof Globe; color: string; group: string }> = {
  DOMAIN:         { label: "Domínio",       Icon: Globe,    color: "text-emerald-400", group: "Domínios" },
  HOSTING:        { label: "Hospedagem",    Icon: Server,   color: "text-cyan-400",    group: "Hospedagem" },
  WEBSITE:        { label: "Site",          Icon: Layout,   color: "text-indigo-400",  group: "Sites" },
  EMAIL_ACCOUNT:  { label: "E-mail",        Icon: Mail,     color: "text-amber-400",   group: "E-mails" },
  DATABASE:       { label: "Banco",         Icon: Database, color: "text-pink-400",    group: "Bancos de dados" },
  DNS_PROVIDER:   { label: "DNS",           Icon: Network,  color: "text-teal-400",    group: "DNS" },
  REPOSITORY:     { label: "Repositório",   Icon: GitBranch,color: "text-orange-400",  group: "Repositórios" },
  SOCIAL_ACCOUNT: { label: "Rede social",   Icon: Share2,   color: "text-purple-400",  group: "Redes sociais" },
  ANALYTICS:      { label: "Analytics",     Icon: BarChart3,color: "text-blue-400",    group: "Analytics" },
  CLOUD_SERVICE:  { label: "Cloud",         Icon: Cloud,    color: "text-sky-400",     group: "Serviços cloud" },
  OTHER:          { label: "Outro",         Icon: Box,      color: "text-slate-400",   group: "Outros" },
};

const TYPE_ORDER: AssetType[] = [
  "DOMAIN", "WEBSITE", "HOSTING", "EMAIL_ACCOUNT", "DATABASE",
  "DNS_PROVIDER", "REPOSITORY", "CLOUD_SERVICE", "ANALYTICS", "SOCIAL_ACCOUNT", "OTHER",
];

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

export default function CompanyVault({ companyId }: { companyId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAssetModal, setShowAssetModal] = useState<{ asset: Asset | null } | null>(null);
  const [showCredModal, setShowCredModal] = useState<{ assetId: string; credential: Credential | null } | null>(null);
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);

  // Senhas reveladas em memória — never persist
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 2FA por e-mail: quando o backend retorna requires2FA, salvamos a ação
  // pendente e abrimos o modal. Após verificação, retomamos a chamada.
  const [pendingReveal, setPendingReveal] = useState<{ credId: string; action: "REVEAL" | "COPY" | "SHARE" } | null>(null);

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function loadAssets() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/vault/assets`);
      if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar cofre");
      const j = await r.json();
      setAssets(j.assets);
      setCanWrite(j.canWrite);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReveal(credId: string, action: "REVEAL" | "COPY" | "SHARE" = "REVEAL") {
    if (revealed[credId] && action === "REVEAL") {
      // toggle: esconde
      setRevealed((p) => { const n = { ...p }; delete n[credId]; return n; });
      return;
    }
    const r = await fetch(`/api/companies/${companyId}/vault/credentials/${credId}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      // 2FA necessário → guarda a ação pendente e abre o modal de verificação
      if (r.status === 403 && err.requires2FA) {
        setPendingReveal({ credId, action });
        return;
      }
      alert(err.error || "Falha ao revelar");
      return;
    }
    const { password } = await r.json();
    if (action === "COPY") {
      await navigator.clipboard.writeText(password);
      setCopiedId(credId);
      setTimeout(() => setCopiedId((c) => (c === credId ? null : c)), 1500);
    } else {
      setRevealed((p) => ({ ...p, [credId]: password }));
    }
    if (action === "SHARE") {
      void loadAssets(); // refresh para mostrar flag sharedWithClient
    }
  }

  async function handleDeleteAsset(assetId: string) {
    if (!confirm("Excluir este ativo e todas as credenciais vinculadas?")) return;
    const r = await fetch(`/api/companies/${companyId}/vault/assets/${assetId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Falha"); return; }
    void loadAssets();
  }

  async function handleDeleteCred(credId: string) {
    if (!confirm("Excluir esta credencial?")) return;
    const r = await fetch(`/api/companies/${companyId}/vault/credentials/${credId}`, { method: "DELETE" });
    if (!r.ok) { alert((await r.json()).error || "Falha"); return; }
    void loadAssets();
  }

  // Agrupa assets por tipo
  const grouped = useMemo(() => {
    const map = new Map<AssetType, Asset[]>();
    for (const a of assets) {
      if (!map.has(a.type)) map.set(a.type, []);
      map.get(a.type)!.push(a);
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }));
  }, [assets]);

  const expiringSoon = useMemo(
    () => assets.filter((a) => {
      const d = daysUntil(a.expiresAt);
      return d !== null && d <= 30 && a.status === "ACTIVE";
    }),
    [assets]
  );

  if (loading) {
    return <div className="p-10 text-center text-slate-500 text-sm">Carregando cofre…</div>;
  }
  if (error) {
    return <div className="p-10 text-center text-red-400 text-sm">{error}</div>;
  }

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400" strokeWidth={2.25} />
          <div>
            <h2 className="text-white font-bold text-sm">Cofre da empresa</h2>
            <p className="text-slate-500 text-[11px]">
              {assets.length} ativo{assets.length !== 1 ? "s" : ""} · senhas criptografadas (AES-256-GCM)
            </p>
          </div>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowAssetModal({ asset: null })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Novo ativo
          </button>
        )}
      </div>

      {/* Painel de orientação de segurança — só pra quem cadastra senha */}
      {canWrite && (
        <div className="mb-4 rounded-lg bg-[#0a1220] border border-[#1e2d45] overflow-hidden">
          <button
            onClick={() => setShowSecurityInfo((s) => !s)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-slate-300 text-xs font-semibold flex-1 text-left">
              Como o cofre protege as senhas
            </span>
            {showSecurityInfo
              ? <ChevronDown className="w-4 h-4 text-slate-500" />
              : <ChevronRight className="w-4 h-4 text-slate-500" />}
          </button>
          {showSecurityInfo && (
            <div className="px-3 pb-3 pt-1 border-t border-[#1e2d45] space-y-3 text-[11px] text-slate-400 leading-relaxed">
              <div className="flex gap-2">
                <Lock className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p>
                  Senhas gravadas <strong className="text-slate-200">criptografadas (AES-256-GCM)</strong>.
                  Cada visualização exige <strong className="text-slate-200">verificação por e-mail</strong> —
                  enviamos um código de 6 dígitos pra sua conta cadastrada.
                </p>
              </div>
              <div className="flex gap-2">
                <Eye className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
                <p>
                  <strong className="text-slate-200">Toda visualização é registrada</strong> (quem viu, quando, IP).
                  Após validar uma vez, próximas senhas podem ser reveladas por 15 min sem novo código.
                </p>
              </div>
              <div className="flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p>
                  <strong className="text-amber-300">Para o admin do servidor:</strong> a chave de criptografia
                  (<code className="bg-black/30 px-1 py-0.5 rounded text-amber-200">ENCRYPTION_KEY</code>) deve
                  ter backup fora do servidor. Sem ela, o banco vira ilegível — é a última linha de defesa do cofre.
                </p>
              </div>
              <div className="flex gap-2">
                <Info className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                <p>
                  Para gerar uma nova chave (uma vez na configuração inicial):{" "}
                  <code className="bg-black/30 px-1 py-0.5 rounded text-slate-300">openssl rand -hex 32</code>
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alertas de expiração */}
      {expiringSoon.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <p className="text-amber-300 font-semibold mb-1">
              {expiringSoon.length} ativo{expiringSoon.length !== 1 ? "s" : ""} com vencimento próximo
            </p>
            <ul className="space-y-0.5 text-amber-200/80">
              {expiringSoon.slice(0, 5).map((a) => {
                const d = daysUntil(a.expiresAt)!;
                return (
                  <li key={a.id}>
                    {a.name} — <span className="font-mono">{d <= 0 ? "vencido" : `${d}d`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-[#1e2d45] rounded-xl">
          <Lock className="w-10 h-10 text-slate-700 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-slate-400 text-sm font-medium mb-1">Cofre vazio</p>
          <p className="text-slate-600 text-xs mb-4">
            Cadastre os recursos digitais que você gerencia para este cliente.
          </p>
          {canWrite && (
            <button
              onClick={() => setShowAssetModal({ asset: null })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar primeiro ativo
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ type, items }) => {
            const meta = TYPE_META[type];
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2.5">
                  <meta.Icon className={`w-4 h-4 ${meta.color}`} strokeWidth={2} />
                  <h3 className="text-slate-300 text-xs font-bold uppercase tracking-wider">
                    {meta.group}
                  </h3>
                  <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded-full">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      canWrite={canWrite}
                      revealed={revealed}
                      copiedId={copiedId}
                      onReveal={handleReveal}
                      onAddCred={() => setShowCredModal({ assetId: asset.id, credential: null })}
                      onEditAsset={() => setShowAssetModal({ asset })}
                      onDeleteAsset={() => handleDeleteAsset(asset.id)}
                      onEditCred={(cred) => setShowCredModal({ assetId: asset.id, credential: cred })}
                      onDeleteCred={handleDeleteCred}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modais */}
      {showAssetModal && (
        <AssetModal
          companyId={companyId}
          asset={showAssetModal.asset}
          onClose={() => setShowAssetModal(null)}
          onSaved={() => { setShowAssetModal(null); void loadAssets(); }}
        />
      )}
      {showCredModal && (
        <CredentialModal
          companyId={companyId}
          assetId={showCredModal.assetId}
          credential={showCredModal.credential}
          onClose={() => setShowCredModal(null)}
          onSaved={() => { setShowCredModal(null); void loadAssets(); }}
        />
      )}

      {/* Modal de verificação por e-mail (2FA do cofre).
          Aparece quando /reveal retorna requires2FA — após validar o código,
          retomamos a chamada original (REVEAL/COPY/SHARE) automaticamente. */}
      {pendingReveal && (
        <VaultVerifyModal
          credentialId={pendingReveal.credId}
          onClose={() => setPendingReveal(null)}
          onVerified={() => {
            const pending = pendingReveal;
            setPendingReveal(null);
            // Retoma a ação original — agora o backend já tem trusted session
            if (pending) void handleReveal(pending.credId, pending.action);
          }}
        />
      )}
    </div>
  );
}

// ─── Card de ativo ────────────────────────────────────────────────────────────

function AssetCard({
  asset, canWrite, revealed, copiedId,
  onReveal, onAddCred, onEditAsset, onDeleteAsset, onEditCred, onDeleteCred,
}: {
  asset: Asset;
  canWrite: boolean;
  revealed: Record<string, string>;
  copiedId: string | null;
  onReveal: (credId: string, action?: "REVEAL" | "COPY" | "SHARE") => void;
  onAddCred: () => void;
  onEditAsset: () => void;
  onDeleteAsset: () => void;
  onEditCred: (c: Credential) => void;
  onDeleteCred: (id: string) => void;
}) {
  const meta = TYPE_META[asset.type];
  const expDays = daysUntil(asset.expiresAt);
  const isExpired = expDays !== null && expDays <= 0;
  const isWarning = expDays !== null && expDays > 0 && expDays <= 30;

  return (
    <div className="bg-[#0a1220] border border-[#1e2d45] rounded-xl overflow-hidden">
      {/* Header do ativo */}
      <div className="flex items-start justify-between p-3 border-b border-[#1e2d45]">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <meta.Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.color}`} strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-white text-sm font-semibold truncate">{asset.name}</h4>
              {asset.provider && (
                <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                  {asset.provider}
                </span>
              )}
              {asset.status !== "ACTIVE" && (
                <span className="text-[10px] text-slate-400 bg-slate-500/15 px-1.5 py-0.5 rounded uppercase font-bold">
                  {asset.status}
                </span>
              )}
              {isExpired && (
                <span className="text-[10px] text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded uppercase font-bold">
                  Vencido
                </span>
              )}
              {isWarning && (
                <span className="text-[10px] text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded font-bold">
                  vence em {expDays}d
                </span>
              )}
            </div>
            {(asset.identifier || asset.url || asset.host) && (
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono truncate">
                {asset.url ? (
                  <a href={asset.url} target="_blank" rel="noreferrer" className="hover:text-indigo-300 truncate flex items-center gap-1">
                    {asset.identifier || asset.url}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : (
                  <span className="truncate">{asset.identifier || asset.host}</span>
                )}
              </div>
            )}
            {asset.notes && (
              <p className="text-slate-500 text-[11px] mt-1 line-clamp-2">{asset.notes}</p>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onEditAsset}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded transition-colors"
              title="Editar ativo"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDeleteAsset}
              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              title="Excluir ativo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Credenciais */}
      <div className="divide-y divide-[#1e2d45]/50">
        {asset.credentials.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-slate-600 text-[11px] mb-2">Nenhuma credencial</p>
            {canWrite && (
              <button
                onClick={onAddCred}
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs font-medium"
              >
                <Plus className="w-3 h-3" /> Adicionar credencial
              </button>
            )}
          </div>
        ) : (
          <>
            {asset.credentials.map((cred) => {
              const shown = revealed[cred.id];
              const wasCopied = copiedId === cred.id;
              return (
                <div key={cred.id} className="px-3 py-2.5 hover:bg-white/[0.02]">
                  <div className="flex items-center gap-2 mb-1">
                    <KeyRound className="w-3 h-3 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-200 text-xs font-medium truncate">{cred.label}</span>
                    {cred.sharedWithClient && (
                      <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase font-bold flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" /> compartilhada
                      </span>
                    )}
                    <div className="flex-1" />
                    {canWrite && (
                      <>
                        <button
                          onClick={() => onEditCred(cred)}
                          className="p-1 text-slate-600 hover:text-slate-300 rounded"
                          title="Editar"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onDeleteCred(cred.id)}
                          className="p-1 text-slate-600 hover:text-red-400 rounded"
                          title="Excluir"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 text-xs ml-5">
                    {cred.username && (
                      <>
                        <span className="text-slate-600">Usuário</span>
                        <div className="flex items-center gap-1.5 group">
                          <span className="text-slate-300 font-mono truncate">{cred.username}</span>
                          <button
                            onClick={() => { void navigator.clipboard.writeText(cred.username!); }}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-indigo-400"
                            title="Copiar"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                    <span className="text-slate-600">Senha</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-300 font-mono truncate">
                        {shown || "••••••••••••"}
                      </span>
                      <button
                        onClick={() => onReveal(cred.id, "REVEAL")}
                        className="text-slate-500 hover:text-indigo-400 p-0.5"
                        title={shown ? "Ocultar" : "Mostrar"}
                      >
                        {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => onReveal(cred.id, "COPY")}
                        className={`p-0.5 ${wasCopied ? "text-emerald-400" : "text-slate-500 hover:text-indigo-400"}`}
                        title="Copiar (registra log)"
                      >
                        {wasCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {cred.url && (
                      <>
                        <span className="text-slate-600">Login</span>
                        <a href={cred.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 truncate flex items-center gap-1">
                          {cred.url}
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      </>
                    )}
                    {cred.notes && (
                      <>
                        <span className="text-slate-600">Obs.</span>
                        <span className="text-slate-400 text-[11px] whitespace-pre-wrap">{cred.notes}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {canWrite && (
              <button
                onClick={onAddCred}
                className="w-full text-left px-3 py-2 text-indigo-400 hover:text-indigo-300 hover:bg-white/[0.02] text-xs font-medium flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3" /> Adicionar credencial
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Modal de Asset ──────────────────────────────────────────────────────────

function AssetModal({
  companyId, asset, onClose, onSaved,
}: {
  companyId: string;
  asset: Asset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: asset?.type ?? ("WEBSITE" as AssetType),
    name: asset?.name ?? "",
    provider: asset?.provider ?? "",
    url: asset?.url ?? "",
    host: asset?.host ?? "",
    identifier: asset?.identifier ?? "",
    expiresAt: asset?.expiresAt ? asset.expiresAt.slice(0, 10) : "",
    status: asset?.status ?? ("ACTIVE" as AssetStatus),
    notes: asset?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) { alert("Nome obrigatório"); return; }
    setSaving(true);
    const url = asset
      ? `/api/companies/${companyId}/vault/assets/${asset.id}`
      : `/api/companies/${companyId}/vault/assets`;
    const r = await fetch(url, {
      method: asset ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        expiresAt: form.expiresAt || null,
      }),
    });
    setSaving(false);
    if (!r.ok) { alert((await r.json()).error || "Erro"); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1525] border border-[#1e2d45] rounded-2xl p-5 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white font-bold text-base mb-4">
          {asset ? "Editar ativo" : "Novo ativo"}
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AssetType })}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>{TYPE_META[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as AssetStatus })}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="ACTIVE">Ativo</option>
                <option value="EXPIRED">Vencido</option>
                <option value="CANCELLED">Cancelado</option>
                <option value="ARCHIVED">Arquivado</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Nome*</label>
            <input
              autoFocus
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder='ex: "Site institucional", "Domínio principal"'
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Provedor</label>
              <input
                type="text"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="Hostinger, Cloudflare…"
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Vencimento</label>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">URL</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Host / IP</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="ftp.x.com / 1.2.3.4:22"
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-[11px] font-semibold mb-1">Identificador</label>
              <input
                type="text"
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder="dominio.com.br / vendas@x"
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Observações</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Salvando…" : (asset ? "Salvar alterações" : "Criar ativo")}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#0a1220] border border-[#1e2d45] text-slate-300 text-sm hover:text-white">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Credencial ─────────────────────────────────────────────────────

function CredentialModal({
  companyId, assetId, credential, onClose, onSaved,
}: {
  companyId: string;
  assetId: string;
  credential: Credential | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    label: credential?.label ?? "",
    username: credential?.username ?? "",
    password: "", // sempre vazio na edição (não trafegamos senha existente sem reveal)
    url: credential?.url ?? "",
    notes: credential?.notes ?? "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.label.trim()) { alert("Label obrigatório"); return; }
    setSaving(true);
    const url = credential
      ? `/api/companies/${companyId}/vault/credentials/${credential.id}`
      : `/api/companies/${companyId}/vault/assets/${assetId}/credentials`;
    // Se editando e password vazio, não envia password (preserva original)
    const body: any = { label: form.label, username: form.username, url: form.url, notes: form.notes };
    if (!credential || form.password) body.password = form.password;
    const r = await fetch(url, {
      method: credential ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { alert((await r.json()).error || "Erro"); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1525] border border-[#1e2d45] rounded-2xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-400" />
          {credential ? "Editar credencial" : "Nova credencial"}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Rótulo*</label>
            <input
              autoFocus
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Admin WordPress, FTP root, cPanel…"
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Usuário</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">
              Senha{credential ? " (deixe vazio p/ manter atual)" : "*"}
            </label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 pr-10 text-sm text-white font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">URL de login</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://site.com/wp-admin"
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-[11px] font-semibold mb-1">Observações</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full bg-[#0a1220] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Salvando…" : (credential ? "Salvar" : "Criar")}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#0a1220] border border-[#1e2d45] text-slate-300 text-sm hover:text-white">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

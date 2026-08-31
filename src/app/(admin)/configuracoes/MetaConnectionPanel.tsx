"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, RefreshCw, MessagesSquare, ExternalLink } from "lucide-react";

/**
 * Conexão de Instagram e Página do Facebook — a autorização em si.
 *
 * Morava dentro de /instagram, misturada com as automações. Conectar é
 * configuração, não operação do dia a dia: agora vive em Configurações →
 * Integrações → Meta, e a tela do Instagram só linka pra cá.
 *
 * Busca o próprio estado em /api/instagram/account (mesma fonte que a tela do
 * Instagram usava), então as duas nunca divergem.
 */

interface Account {
  username: string;
  profilePictureUrl?: string | null;
  tokenExpiresAt?: string | null;
}

export default function MetaConnectionPanel() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [fbConnectUrl, setFbConnectUrl] = useState("");
  const [fbPages, setFbPages] = useState<{ id: string; name: string | null }[]>([]);
  const [resub, setResub] = useState("");
  const [resubbing, setResubbing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/instagram/account").then((x) => x.json());
      setAccount(r.account ?? null);
      setConnectUrl(r.connectUrl || "");
      setFbConnectUrl(r.fbConnectUrl || "");
      setFbPages(r.facebookPages || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function resubscribe() {
    setResubbing(true);
    setResub("");
    try {
      const r = await fetch("/api/instagram/account/resubscribe", { method: "POST" }).then((x) => x.json());
      setResub(r.ok ? `Conexão atualizada ✓ (${(r.fields || []).join(", ")})` : `Erro: ${r.error || "falhou"}`);
    } catch {
      setResub("Erro de rede");
    } finally {
      setResubbing(false);
    }
  }

  async function removeFbPage(id: string) {
    if (!confirm("Remover esta página desta empresa?")) return;
    await fetch(`/api/instagram/facebook-pages/${id}`, { method: "DELETE" });
    void load();
  }

  if (loading) {
    return <div className="text-slate-500 text-xs py-4">Carregando conexão…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Instagram */}
      {account ? (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
          {account.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.profilePictureUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500 to-indigo-500" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">@{account.username}</p>
            {account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() ? (
              <p className="text-[11px] text-amber-400">
                Token vencido em {new Date(account.tokenExpiresAt).toLocaleDateString("pt-BR")} — reconecte a conta
              </p>
            ) : (
              <p className="text-[11px] text-emerald-400">Instagram conectado</p>
            )}
            {resub && <p className="text-[11px] text-slate-400 mt-0.5">{resub}</p>}
          </div>
          {connectUrl && (
            <a
              href={connectUrl}
              className={`rounded-lg px-3 py-1.5 text-xs flex-shrink-0 ${
                account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now()
                  ? "bg-gradient-to-r from-pink-500 to-indigo-500 text-white font-medium hover:opacity-90"
                  : "border border-white/10 text-slate-300 hover:bg-white/5"
              }`}
              title="Refaz a autorização no Instagram (renova o token de 60 dias)"
            >
              Reconectar
            </a>
          )}
          <button
            onClick={resubscribe}
            disabled={resubbing}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50 flex-shrink-0"
            title="Reativa os webhooks (comentários, DMs e cliques de botão) desta conta"
          >
            {resubbing ? "Atualizando…" : "Atualizar conexão"}
          </button>
          <button onClick={() => void load()} className="text-slate-500 hover:text-white flex-shrink-0" title="Recarregar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-slate-300 text-xs mb-3">
            Conecte uma conta profissional do Instagram para receber Direct no inbox e criar
            automações de comentário.
          </p>
          {connectUrl && (
            <a
              href={connectUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 to-indigo-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Camera className="w-4 h-4" /> Conectar Instagram
            </a>
          )}
        </div>
      )}

      {/* Facebook / Messenger */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <MessagesSquare className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">Facebook / Messenger</p>
              {!fbPages.length && <p className="text-[11px] text-slate-400">Nenhuma página conectada</p>}
            </div>
          </div>
          {fbConnectUrl && (
            <a
              href={fbConnectUrl}
              className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/10 flex-shrink-0"
            >
              {fbPages.length ? "Reconectar / adicionar" : "Conectar Facebook"}
            </a>
          )}
        </div>

        {fbPages.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {fbPages.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <span className="text-slate-200 truncate flex-1">{p.name || p.id}</span>
                <button
                  onClick={() => removeFbPage(p.id)}
                  className="text-slate-500 hover:text-red-400 flex-shrink-0"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-slate-500 mt-2">
          Os DMs do Messenger caem na{" "}
          <a href="/instagram/inbox" className="text-indigo-300 hover:text-indigo-200">Inbox Social</a>{" "}
          com o selo Messenger.
        </p>
      </div>

      <a
        href="/instagram"
        className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300"
      >
        Automações e relatórios do Instagram <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

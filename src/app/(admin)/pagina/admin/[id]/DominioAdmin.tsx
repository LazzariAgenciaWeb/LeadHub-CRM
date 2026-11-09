"use client";

import { useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { BIO_DOMAIN_STATUS_LABEL, normalizeBioDomain, type BioDomainStatus } from "@/lib/bio-page";

/**
 * Domínio próprio da página, pelo painel da agência. Aqui a AZZ cadastra o
 * domínio de quem contratou por fora, reconfere na hora e ATIVA À MÃO quando o
 * domínio já está servido por outro caminho (sem custom hostname pra consultar).
 */

interface DomainView {
  hostname: string;
  status: BioDomainStatus;
  statusMessage: string | null;
  cname: { name: string; value: string };
  txt: { name: string; value: string } | null;
  root: boolean;
  automatic: boolean;
  manual: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  url: string | null;
}

type Action = "cadastrar" | "verificar" | "ativar" | "pendente" | "remover";

const STATUS_STYLE: Record<BioDomainStatus, string> = {
  PENDING: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  VERIFYING: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  ACTIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  ERROR: "bg-red-500/15 text-red-300 border-red-500/25",
};

export default function DominioAdmin({
  pageId,
  initial,
  target,
}: {
  pageId: string;
  initial: DomainView | null;
  target: string;
}) {
  const [domain, setDomain] = useState(initial);
  const [host, setHost] = useState(initial?.hostname ?? "");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    if (action === "remover" && !confirm("Tirar o domínio desta página? O site volta a abrir só no endereço do GoHub.")) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/pagina/admin/dominio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, action, hostname: host }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Não deu pra concluir.");
        return;
      }
      setDomain(j.domain);
      setHost(j.domain?.hostname ?? "");
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      setBusy(null);
    }
  }

  const botao =
    "inline-flex items-center gap-1.5 rounded-md border border-[#1e2d45] bg-[#161f30] px-2.5 py-1.5 text-xs text-slate-200 hover:text-white disabled:opacity-50";

  return (
    <section className="rounded-xl border border-[#1e2d45] bg-[#0f1623] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe className="h-4 w-4 text-indigo-300" /> Domínio próprio
        </h2>
        {domain && (
          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[domain.status]}`}>
            {BIO_DOMAIN_STATUS_LABEL[domain.status]}
            {domain.manual ? " (à mão)" : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-[#1e2d45] bg-[#161f30] px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
          placeholder="www.cliente.com.br"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <button type="button" disabled={!normalizeBioDomain(host) || !!busy} onClick={() => run("cadastrar")} className={botao}>
          {busy === "cadastrar" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {domain ? "Trocar" : "Cadastrar"}
        </button>
      </div>

      {domain && (
        <>
          <dl className="mt-3 space-y-1 text-xs text-slate-400">
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-slate-500">CNAME</dt>
              <dd className="min-w-0 truncate">
                {domain.cname.name} → {domain.cname.value}
              </dd>
            </div>
            {domain.txt && (
              <div className="flex gap-2">
                <dt className="w-24 flex-shrink-0 text-slate-500">TXT</dt>
                <dd className="min-w-0 truncate">
                  {domain.txt.name} → {domain.txt.value}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 flex-shrink-0 text-slate-500">HTTPS</dt>
              <dd>{domain.automatic ? "automático (Cloudflare configurada)" : "manual (Cloudflare sem token no servidor)"}</dd>
            </div>
            {domain.statusMessage && (
              <div className="flex gap-2">
                <dt className="w-24 flex-shrink-0 text-slate-500">Situação</dt>
                <dd className="min-w-0">{domain.statusMessage}</dd>
              </div>
            )}
            {domain.lastCheckedAt && (
              <div className="flex gap-2">
                <dt className="w-24 flex-shrink-0 text-slate-500">Verificado</dt>
                <dd>{new Date(domain.lastCheckedAt).toLocaleString("pt-BR")}</dd>
              </div>
            )}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!busy} onClick={() => run("verificar")} className={botao}>
              {busy === "verificar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Verificar
            </button>
            {domain.status !== "ACTIVE" ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => run("ativar")}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === "ativar" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Ativar à mão
              </button>
            ) : (
              <button type="button" disabled={!!busy} onClick={() => run("pendente")} className={botao}>
                {busy === "pendente" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Voltar para pendente
              </button>
            )}
            {domain.url && (
              <a href={domain.url} target="_blank" rel="noopener noreferrer" className={botao}>
                <ExternalLink className="h-3.5 w-3.5" /> Abrir
              </a>
            )}
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("remover")}
              className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
            >
              Remover
            </button>
          </div>
        </>
      )}

      {!domain && (
        <p className="mt-2 text-[11px] text-slate-500">
          O cliente aponta o domínio para <code className="text-slate-400">{target}</code>. Ativar à mão só depois de
          confirmar que o domínio abre o site — o status ativo é o que faz o proxy servir a página nele.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { BIO_DOMAIN_STATUS_LABEL, normalizeBioDomain, type BioDomainStatus } from "@/lib/bio-page";

/**
 * "Seu site no seu domínio" — cartão do passo Publicar.
 *
 * O dono escreve o domínio dele, a tela mostra os registros de DNS para copiar
 * e o botão que reconfere o apontamento. O certificado é emitido automaticamente
 * depois que o DNS aponta (ver src/lib/bio-domain.ts).
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

type Payload = { domain: DomainView | null; allowed: boolean; target: string };

const STATUS_STYLE: Record<BioDomainStatus, string> = {
  PENDING: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  VERIFYING: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  ACTIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  ERROR: "bg-red-500/15 text-red-300 border-red-500/25",
};

const inputCls =
  "w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500";

function CopyRow({ label, value, help }: { label: string; value: string; help?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-slate-400 text-[11px] font-semibold">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-[#161f30] px-2 py-1.5 text-xs text-slate-200">{value}</code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-[#1e2d45] bg-[#161f30] px-2.5 py-1.5 text-xs text-slate-200"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {help && <p className="mt-1 text-[11px] text-slate-500">{help}</p>}
    </div>
  );
}

export default function DominioProprio({ planLabel }: { planLabel: string }) {
  const [state, setState] = useState<Payload | null>(null);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | "check" | "remove" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((p: Payload) => {
    if (!mounted.current) return;
    setState(p);
    setHost(p.domain?.hostname ?? "");
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/pagina/dominio").catch(() => null);
      if (res?.ok) apply(await res.json());
      if (mounted.current) setBusy(null);
    })();
  }, [apply]);

  async function call(method: "PUT" | "POST" | "DELETE", acao: "save" | "check" | "remove") {
    setBusy(acao);
    setError(null);
    setSuggestion(null);
    try {
      const res = await fetch("/api/pagina/dominio", {
        method,
        ...(method === "PUT"
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname: host }) }
          : {}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Não deu pra concluir agora. Tente de novo.");
        setSuggestion(j.suggestion ?? null);
        return;
      }
      apply(j);
    } catch {
      setError("Sem conexão com o servidor.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  // Enquanto o domínio não está no ar, a tela se atualiza sozinha: a validação
  // e o certificado levam alguns minutos e ninguém fica apertando o botão.
  const naoEstaNoAr = !!state?.domain && state.domain.status !== "ACTIVE" && !state.domain.manual;
  useEffect(() => {
    if (!naoEstaNoAr) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/pagina/dominio", { method: "POST" }).catch(() => null);
      if (res?.ok) apply(await res.json());
    }, 60_000);
    return () => clearInterval(t);
  }, [naoEstaNoAr, apply]);

  if (busy === "load") {
    return (
      <div className="rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3 text-xs text-slate-500">
        <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Carregando domínio…
      </div>
    );
  }
  if (!state) return null;

  // ── Plano sem site próprio: convite, sem campo ──
  if (!state.allowed) {
    return (
      <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe className="h-4 w-4 text-fuchsia-300" /> Seu site no seu domínio
        </p>
        <p className="mt-1 text-xs text-fuchsia-100">
          No plano {planLabel} sua página fica no endereço do GoHub. A partir do Essencial ela vira o site da sua
          empresa: abre em <strong>www.suaempresa.com.br</strong>, com cadeado de segurança e pronta para aparecer no
          Google.
        </p>
        <a
          href="/planos"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-500"
        >
          Ver o Essencial <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  const d = state.domain;

  // ── Ainda sem domínio: só o campo ──
  if (!d) {
    const limpo = normalizeBioDomain(host);
    return (
      <div className="rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe className="h-4 w-4 text-indigo-300" /> Seu site no seu domínio
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          Já tem um domínio? Escreva ele aqui e a gente mostra o que configurar. Sua página passa a abrir nele, com
          cadeado de segurança.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className={`${inputCls} flex-1 min-w-[200px]`}
            placeholder="www.suaempresa.com.br"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && limpo) call("PUT", "save");
            }}
          />
          <button
            type="button"
            disabled={!limpo || busy === "save"}
            onClick={() => call("PUT", "save")}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
            Usar este domínio
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {suggestion && (
          <button
            type="button"
            onClick={() => setHost(suggestion)}
            className="mt-1 text-xs text-indigo-300 underline hover:text-indigo-200"
          >
            Usar {suggestion}
          </button>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Não tem domínio ainda? A AZZ registra pra você — fale com a gente pelo chamado.
        </p>
      </div>
    );
  }

  // ── Domínio cadastrado: status e o que configurar ──
  const ativo = d.status === "ACTIVE";
  return (
    <div className="rounded-lg border border-[#1e2d45] bg-[#0b111c] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <Globe className="h-4 w-4 text-indigo-300" /> Seu site no seu domínio
        </p>
        <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[d.status]}`}>
          {BIO_DOMAIN_STATUS_LABEL[d.status]}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-[#161f30] px-2 py-1.5 text-xs text-slate-200">
          {d.hostname}
        </code>
        {ativo && d.url && (
          <a
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-[#1e2d45] bg-[#161f30] px-2.5 py-1.5 text-xs text-slate-200"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir
          </a>
        )}
      </div>

      {ativo ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-300">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          Seu site está no ar neste domínio, com cadeado de segurança. As visitas, os cliques e os contatos continuam
          sendo contados no seu painel.
        </p>
      ) : (
        <>
          {d.statusMessage && (
            <p
              className={`mt-2 flex items-start gap-1.5 text-xs ${d.status === "ERROR" ? "text-red-300" : "text-slate-400"}`}
            >
              {d.status === "ERROR" && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
              {d.statusMessage}
            </p>
          )}

          <div className="mt-3 space-y-3 rounded-lg border border-[#1e2d45] bg-[#0f1623] p-3">
            <p className="text-xs text-slate-300">
              Entre no painel onde seu domínio está registrado (Registro.br, Hostgator, GoDaddy…), abra a zona de DNS e
              crie {d.txt ? "estes dois registros" : "este registro"}:
            </p>
            <CopyRow label="1. Registro CNAME — nome" value={d.cname.name} />
            <CopyRow
              label="1. Registro CNAME — valor (para onde aponta)"
              value={d.cname.value}
              help="Tipo do registro: CNAME. É ele que faz seu domínio abrir o site."
            />
            {d.txt && (
              <>
                <CopyRow label="2. Registro TXT — nome" value={d.txt.name} />
                <CopyRow
                  label="2. Registro TXT — valor"
                  value={d.txt.value}
                  help="Tipo do registro: TXT. Serve para provar que o domínio é seu e liberar o cadeado de segurança."
                />
              </>
            )}
            {d.root && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
                <strong>{d.hostname}</strong> é a raiz do domínio, e a maioria dos provedores não aceita CNAME na raiz.
                O caminho mais simples é usar <strong>www.{d.hostname}</strong> aqui e deixar a raiz redirecionando para
                o www no painel do seu provedor. Se preferir a raiz sem o www, fale com a AZZ — a gente ajusta o DNS por
                você.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              Depois de salvar no seu provedor, o DNS costuma levar de alguns minutos a algumas horas para valer em todo
              lugar. Esta tela se atualiza sozinha.
            </p>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!ativo && (
          <button
            type="button"
            disabled={busy === "check"}
            onClick={() => call("POST", "check")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e2d45] bg-[#161f30] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white disabled:opacity-50"
          >
            {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Verificar agora
          </button>
        )}
        <button
          type="button"
          disabled={busy === "remove"}
          onClick={() => call("DELETE", "remove")}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Trocar ou tirar este domínio
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {d.lastCheckedAt && (
        <p className="mt-2 text-[11px] text-slate-600">
          Última verificação: {new Date(d.lastCheckedAt).toLocaleString("pt-BR")}
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2, Copy, Check, X, ExternalLink } from "lucide-react";

interface Settings {
  email: string;
  username: string;
  incomingHost: string;
  imapPort: number;
  pop3Port: number;
  smtpHost: string;
  smtpPort: number;
  smtpStartTlsPort: number;
  webmailUrl: string;
}

const APPS: { id: string; label: string; steps: string[] }[] = [
  {
    id: "outlook", label: "Outlook",
    steps: [
      "Abra o Outlook e vá em Adicionar conta (Arquivo → Adicionar conta, ou Configurações → Contas).",
      "Digite o endereço de e-mail e escolha configurar manualmente / opções avançadas.",
      "Escolha o tipo IMAP e preencha os servidores e portas abaixo.",
      "Em criptografia, escolha SSL/TLS. Informe a senha da caixa e conclua.",
    ],
  },
  {
    id: "iphone", label: "iPhone / Mac",
    steps: [
      "iPhone: Ajustes → Mail → Contas → Adicionar Conta → Outra → Adicionar Conta de E-mail. No Mac: app Mail → Adicionar Conta → Outra conta do Mail.",
      "Informe nome, e-mail e senha e toque em Seguinte.",
      "Escolha IMAP e preencha Servidor de Entrada e Servidor de Saída com os dados abaixo (usuário = e-mail completo).",
      "Se pedir, deixe \"Usar SSL\" ligado com as portas abaixo.",
    ],
  },
  {
    id: "android", label: "Android / Gmail",
    steps: [
      "No app Gmail: toque na sua foto → Adicionar outra conta → Outra.",
      "Digite o e-mail e toque em Configuração manual → Pessoal (IMAP).",
      "Informe a senha e preencha o servidor de entrada e de saída com os dados abaixo.",
      "Tipo de segurança: SSL/TLS.",
    ],
  },
];

/**
 * Instruções pra configurar uma caixa num app de e-mail (Outlook, celular...).
 * Só leitura: servidor e portas vêm do cPanel; senha não passa por aqui.
 */
export default function MailClientSetup({ baseUrl, email, onClose }: { baseUrl: string; email: string; onClose: () => void }) {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState(APPS[0].id);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${baseUrl}?config=${encodeURIComponent(email)}`);
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(j.error || "Não foi possível buscar a configuração.");
        else setData(j);
      } catch {
        if (!cancelled) setError("Erro de rede.");
      }
    })();
    return () => { cancelled = true; };
  }, [baseUrl, email]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* sem permissão de área de transferência */ }
  }

  function fullText(s: Settings): string {
    return [
      `Configuração do e-mail ${s.email}`,
      ``,
      `Usuário: ${s.username}`,
      `Senha: a senha da caixa de e-mail`,
      ``,
      `ENTRADA (recomendado IMAP)`,
      `Servidor: ${s.incomingHost}`,
      `IMAP: porta ${s.imapPort} · SSL/TLS`,
      `POP3: porta ${s.pop3Port} · SSL/TLS (só se quiser baixar e apagar do servidor)`,
      ``,
      `SAÍDA (SMTP)`,
      `Servidor: ${s.smtpHost}`,
      `Porta: ${s.smtpPort} · SSL/TLS (ou ${s.smtpStartTlsPort} · STARTTLS)`,
      `Exige autenticação: sim, mesmo usuário e senha da entrada`,
      ``,
      `Webmail: ${s.webmailUrl}`,
    ].join("\n");
  }

  const smallBtn = "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition-colors";

  function row(k: string, label: string, value: string, hint?: string) {
    return (
      <div key={k} className="flex items-center gap-2 py-1">
        <span className="w-28 flex-shrink-0 text-slate-400 text-[11px]">{label}</span>
        <span className="flex-1 min-w-0 text-white text-xs font-mono truncate">
          {value}{hint && <span className="ml-2 font-sans text-slate-500 text-[10px]">{hint}</span>}
        </span>
        <button type="button" onClick={() => copy(k, value)} title="Copiar"
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10">
          {copied === k ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    );
  }

  const current = APPS.find((a) => a.id === app) ?? APPS[0];

  return (
    <div className="border border-cyan-500/30 bg-cyan-500/5 rounded-lg p-3 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-white text-xs font-semibold flex-1">Configurar <span className="font-mono">{email}</span> no app de e-mail</p>
        {data && (
          <button type="button" onClick={() => copy("all", fullText(data))}
            className={`${smallBtn} bg-indigo-600 hover:bg-indigo-500 text-white`}>
            {copied === "all" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === "all" ? "Copiado" : "Copiar tudo"}
          </button>
        )}
        <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10" title="Fechar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!data && !error && <p className="text-slate-400 text-[11px] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> buscando no servidor…</p>}
      {error && <p className="p-2 rounded-lg border bg-red-500/10 border-red-500/30 text-red-200 text-[11px]">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <p className="text-cyan-300 text-[10px] font-bold uppercase tracking-wide mt-1">Login</p>
              {row("user", "Usuário", data.username, "e-mail completo")}
              <p className="text-slate-500 text-[10px] pl-28">Senha: a da caixa de e-mail.</p>

              <p className="text-cyan-300 text-[10px] font-bold uppercase tracking-wide mt-3">Entrada</p>
              {row("in", "Servidor", data.incomingHost)}
              {row("imap", "IMAP (recomendado)", String(data.imapPort), "SSL/TLS")}
              {row("pop", "POP3", String(data.pop3Port), "SSL/TLS")}
            </div>
            <div>
              <p className="text-cyan-300 text-[10px] font-bold uppercase tracking-wide mt-1">Saída (SMTP)</p>
              {row("out", "Servidor", data.smtpHost)}
              {row("smtp", "Porta", String(data.smtpPort), "SSL/TLS")}
              {row("smtp2", "Alternativa", String(data.smtpStartTlsPort), "STARTTLS")}
              <p className="text-slate-500 text-[10px] pl-28">Exige autenticação: mesmo usuário e senha.</p>

              <p className="text-cyan-300 text-[10px] font-bold uppercase tracking-wide mt-3">Webmail</p>
              <div className="flex items-center gap-2 py-1">
                <span className="w-28 flex-shrink-0 text-slate-400 text-[11px]">Pelo navegador</span>
                <a href={data.webmailUrl} target="_blank" rel="noopener noreferrer"
                  className="text-indigo-300 hover:text-indigo-200 text-xs font-mono truncate flex items-center gap-1">
                  {data.webmailUrl} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-3 space-y-2">
            <div className="flex gap-1 flex-wrap">
              {APPS.map((a) => (
                <button key={a.id} type="button" onClick={() => setApp(a.id)}
                  className={`${smallBtn} ${app === a.id ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                  {a.label}
                </button>
              ))}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px]">
              {current.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <p className="text-slate-500 text-[10px]">
              Use IMAP pra ver os mesmos e-mails no computador e no celular. POP3 baixa as mensagens pra um aparelho só.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

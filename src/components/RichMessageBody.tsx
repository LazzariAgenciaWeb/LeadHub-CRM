"use client";

import { useState, type ReactNode } from "react";

// Formatação leve estilo WhatsApp/Markdown pra corpo de mensagem em chamados:
//   **negrito**             → <strong>
//   linha "- " / "* " / "• " → <ul><li>
//   linha "1." / "1) "       → <ol><li>
//   http(s)://... e www...   → link clicável + botões copiar/abrir ao lado
//
// Renderização é read-only, não muda o que fica salvo no banco (o autor digitou).
// Editor continua sendo textarea pura — segue o padrão do WhatsApp (o usuário
// digita `**bold**` e vê o negrito ao enviar).

// URL: http(s)://... ou www.... (para até espaço/ponto-final/parênteses).
// Não pega pontuação final ("." "," ")") pra não sujar o link com sinal do texto.
const URL_RE = /(https?:\/\/[^\s<>"'()]+[^\s<>"'.,;:!?()]|www\.[^\s<>"'()]+[^\s<>"'.,;:!?()])/gi;

// **texto** (sem quebra de linha no meio, sem asterisco interno)
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;

type Block =
  | { type: "p";  lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

const BULLET_RE   = /^\s*[*\-•]\s+/;
const NUMBERED_RE = /^\s*\d+[.)]\s+/;

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    if (BULLET_RE.test(raw)) {
      const item = raw.replace(BULLET_RE, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else if (NUMBERED_RE.test(raw)) {
      const item = raw.replace(NUMBERED_RE, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "ol") last.items.push(item);
      else blocks.push({ type: "ol", items: [item] });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.type === "p") last.lines.push(raw);
      else blocks.push({ type: "p", lines: [raw] });
    }
  }
  return blocks;
}

export function RichMessageBody({
  text,
  className,
  linkClassName,
}: {
  text: string | null | undefined;
  className?: string;
  // Classe do <a>. Default é indigo; sobrescreva quando o balão é colorido
  // (mensagem do admin em bg indigo, nota interna em amber, etc.).
  linkClassName?: string;
}) {
  if (!text) return null;
  const blocks = toBlocks(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc list-outside pl-5 my-1 space-y-0.5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it, linkClassName)}</li>)}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="list-decimal list-outside pl-5 my-1 space-y-0.5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it, linkClassName)}</li>)}
            </ol>
          );
        }
        // Parágrafo: junta linhas com \n e preserva quebras via whitespace-pre-wrap.
        // Blocos consecutivos ganham margin top pra separar de listas.
        return (
          <p key={i} className={`whitespace-pre-wrap break-words ${i > 0 ? "mt-2" : ""}`}>
            {renderInline(b.lines.join("\n"), linkClassName)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string, linkClassName?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(...renderBold(text.slice(lastIdx, m.index), `t${key++}`));
    }
    const raw = m[0];
    const href = raw.startsWith("www.") ? `https://${raw}` : raw;
    out.push(<LinkChip key={`u${key++}`} href={href} label={raw} linkClassName={linkClassName} />);
    lastIdx = m.index + raw.length;
  }
  if (lastIdx < text.length) {
    out.push(...renderBold(text.slice(lastIdx), `t${key++}`));
  }
  return out;
}

function renderBold(text: string, baseKey: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    out.push(<strong key={`${baseKey}-b${key++}`} className="font-semibold">{m[1]}</strong>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function LinkChip({
  href,
  label,
  linkClassName,
}: {
  href: string;
  label: string;
  linkClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard bloqueado no browser */ }
  }
  const anchorCls = linkClassName ?? "text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/40 break-all";
  return (
    <span className="inline-flex items-baseline gap-1 max-w-full align-baseline">
      <a href={href} target="_blank" rel="noopener noreferrer" title={href} className={anchorCls}>
        {label}
      </a>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir em nova aba"
        aria-label="Abrir link em nova aba"
        className="inline-flex items-center justify-center h-4 px-1 rounded border border-current/20 text-current/70 hover:text-current text-[10px] leading-none no-underline"
      >
        ↗
      </a>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copiado!" : "Copiar URL"}
        aria-label="Copiar URL"
        className="inline-flex items-center justify-center h-4 px-1 rounded border border-current/20 text-current/70 hover:text-current text-[10px] leading-none"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

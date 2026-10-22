import type { ReactNode } from "react";

/**
 * Markdown → React, SEM HTML cru (nada de dangerouslySetInnerHTML).
 *
 * Feito pra ler matéria de blog no link de aprovação, que é PÚBLICO: um .md
 * com <script> ou onerror=… vira texto, nunca código. Cobre o que um artigo
 * usa — títulos, parágrafos, **negrito**, *itálico*, `código`, [links](url),
 * listas, citações, blocos de código, linha horizontal e imagens https.
 * Tabela e HTML embutido aparecem como texto.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Ordem importa: imagem antes de link; código antes de ênfase.
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[2] !== undefined) {
      // eslint-disable-next-line @next/next/no-img-element
      out.push(/^https:\/\//i.test(m[2]) ? <img key={key} src={m[2]} alt={m[1]} loading="lazy" /> : m[0]);
    } else if (m[4] !== undefined) {
      out.push(SAFE_URL.test(m[4])
        ? <a key={key} href={m[4]} target="_blank" rel="noopener noreferrer nofollow">{inline(m[3], key)}</a>
        : m[3]);
    } else if (m[5] !== undefined) out.push(<code key={key}>{m[5]}</code>);
    else if (m[6] !== undefined || m[7] !== undefined) out.push(<strong key={key}>{inline(m[6] ?? m[7], key)}</strong>);
    else out.push(<em key={key}>{inline(m[8] ?? m[9], key)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownDoc({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;

    if (!line.trim()) { i++; continue; }

    // Bloco de código ```
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key}><code>{body.join("\n")}</code></pre>);
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 4);
      const content = inline(h[2], key);
      blocks.push(
        level === 1 ? <h1 key={key}>{content}</h1>
        : level === 2 ? <h2 key={key}>{content}</h2>
        : level === 3 ? <h3 key={key}>{content}</h3>
        : <h4 key={key}>{content}</h4>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key} />); i++; continue; }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(body.join(" "), key)}</blockquote>);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(<ul key={key}>{items.map((it, j) => <li key={j}>{inline(it, `${key}-${j}`)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={key}>{items.map((it, j) => <li key={j}>{inline(it, `${key}-${j}`)}</li>)}</ol>);
      continue;
    }

    // Parágrafo: junta linhas até uma em branco ou outro tipo de bloco.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>|[-*+]\s+|\d+[.)]\s+)/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
    ) para.push(lines[i++].trim());
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }

  return <div className={className}>{blocks}</div>;
}

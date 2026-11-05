import type { CSSProperties, ReactNode } from "react";
import { parseDocument } from "htmlparser2";
import type { ChildNode, Element } from "domhandler";

/**
 * HTML → React por lista branca, SEM dangerouslySetInnerHTML.
 *
 * O texto é parseado (htmlparser2, roda igual no servidor e no browser) e só
 * viram elemento as tags e atributos listados abaixo; o resto é descartado
 * (script/style/iframe/form somem com o conteúdo, tag desconhecida vira só o
 * texto de dentro). Nada de on*=, link só http(s)/mailto/tel, imagem só https,
 * e `style` passa por filtro de propriedades sem url()/expression/position.
 * Texto sempre vai como filho do React, que escapa.
 */

const TAGS = new Set([
  "p", "div", "span", "br", "hr", "section", "article", "header", "footer", "main", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small", "sub", "sup", "abbr", "cite", "q",
  "blockquote", "pre", "code", "kbd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "a", "img", "figure", "figcaption", "details", "summary", "input",
]);
/** Somem junto com tudo que tiverem dentro. */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "button", "select", "textarea", "noscript", "template", "svg", "math", "head", "title", "meta", "link"]);
const VOID = new Set(["br", "hr", "img", "input", "col"]);
const NO_TEXT = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup", "ul", "ol", "dl"]);

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#)/i;

const STYLE_PROPS = new Set([
  "color", "background-color", "font-weight", "font-style", "font-size", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-transform", "vertical-align", "white-space",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width", "border-style", "border-radius",
  "width", "max-width", "min-width", "height", "max-height",
  "display", "gap", "flex", "flex-direction", "flex-wrap", "align-items", "justify-content",
  "grid-template-columns", "list-style-type", "opacity",
]);
const BAD_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|[<>]|\\/i;

function cssToObject(css: string): CSSProperties | undefined {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim().replace(/!important$/i, "").trim();
    if (!STYLE_PROPS.has(prop) || !val || BAD_VALUE.test(val) || val.length > 200) continue;
    if (prop === "display" && !/^(block|inline|inline-block|flex|inline-flex|grid|none|table|table-row|table-cell|list-item)$/.test(val)) continue;
    out[prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = val;
  }
  return Object.keys(out).length ? (out as CSSProperties) : undefined;
}

const intAttr = (v: string | undefined) => (v && /^\d{1,4}$/.test(v) ? Number(v) : undefined);

/** Parece HTML? (tem pelo menos uma tag de bloco/formatação conhecida) */
export function looksLikeHtml(text: string): boolean {
  return /<(p|div|h[1-6]|ul|ol|li|table|section|article|strong|b|em|br|span|blockquote|a|img|hr|details|input)\b[^>]*>/i.test(text);
}

/**
 * HTML "de página": traz CSS próprio (<style>, class=, <html>/<body>, folha
 * externa). Esse precisa do HtmlFrame pra aparecer como foi desenhado — a lista
 * branca daqui descarta CSS e classes.
 */
export function isStyledHtml(text: string): boolean {
  return /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<link\b[^>]*stylesheet|\sclass\s*=/i.test(text);
}

const CHECKBOX_RE = /<input\b[^>]*\btype\s*=\s*["']?checkbox\b[^>]*>/gi;

/** Checklist do HTML: <input type="checkbox"> (marcado = atributo checked). */
export function htmlCheckProgress(text: string): { total: number; feitos: number } {
  const all = text.match(CHECKBOX_RE) ?? [];
  return { total: all.length, feitos: all.filter((t) => /\bchecked\b/i.test(t)).length };
}

/** Inverte o n-ésimo checkbox do HTML (mesma ordem em que aparecem no texto). */
export function toggleHtmlCheck(text: string, index: number): string {
  let n = -1;
  return text.replace(CHECKBOX_RE, (tag) => {
    n++;
    if (n !== index) return tag;
    return /\bchecked\b/i.test(tag)
      ? tag.replace(/\s+checked(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/i, "")
      : tag.replace(/\s*\/?>$/, (end) => ` checked${end}`);
  });
}

export function HtmlDoc({ text, className, onToggleCheck }: { text: string; className?: string; onToggleCheck?: (index: number) => void }) {
  const doc = parseDocument(text, { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true });
  let checkIdx = 0;

  function render(nodes: ChildNode[], keyBase: string, parent = ""): ReactNode[] {
    const out: ReactNode[] = [];
    // <table><tr> direto: o browser enfia um <tbody>; faz igual pra não dar erro de hidratação.
    if (parent === "table" && nodes.some((n) => n.type === "tag" && (n as Element).name === "tr")) {
      const rows = nodes.filter((n) => n.type === "tag" && (n as Element).name === "tr");
      const rest = nodes.filter((n) => !rows.includes(n));
      return [...render(rest, keyBase, parent), <tbody key={`${keyBase}-tb`}>{render(rows, `${keyBase}-tb`, "tbody")}</tbody>];
    }
    nodes.forEach((n, i) => {
      const key = `${keyBase}-${i}`;
      if (n.type === "text") {
        const data = (n as unknown as { data: string }).data;
        // Espaço entre <tr>/<li>… não pode virar nó de texto dentro de tabela/lista.
        if (NO_TEXT.has(parent) && !data.trim()) return;
        out.push(data);
        return;
      }
      if (n.type !== "tag") return; // comentário, doctype, <script> (type "script"), <style> (type "style")
      const el = n as Element;
      const tag = el.name;
      if (DROP.has(tag)) return;
      if (!TAGS.has(tag)) { out.push(...render(el.children, key, parent)); return; }

      const a = el.attribs ?? {};
      const props: Record<string, unknown> = {};
      if (a.style) { const st = cssToObject(a.style); if (st) props.style = st; }
      if (a.title) props.title = a.title.slice(0, 300);

      if (tag === "a") {
        if (a.href && SAFE_HREF.test(a.href.trim())) {
          props.href = a.href.trim();
          if (!a.href.startsWith("#")) { props.target = "_blank"; props.rel = "noopener noreferrer nofollow"; }
        }
      } else if (tag === "img") {
        if (!a.src || !/^https:\/\//i.test(a.src.trim())) return;
        props.src = a.src.trim(); props.alt = a.alt ?? ""; props.loading = "lazy";
        props.width = intAttr(a.width); props.height = intAttr(a.height);
        // eslint-disable-next-line @next/next/no-img-element
        out.push(<img key={key} {...props} alt={String(props.alt)} />);
        return;
      } else if (tag === "input") {
        if ((a.type ?? "").toLowerCase() !== "checkbox") return;
        const idx = checkIdx++;
        const checked = "checked" in a;
        out.push(onToggleCheck
          ? <input key={key} type="checkbox" checked={checked} onChange={() => onToggleCheck(idx)} className="md-html-check" />
          : <input key={key} type="checkbox" checked={checked} readOnly disabled className="md-html-check" />);
        return;
      } else if (tag === "td" || tag === "th") {
        props.colSpan = intAttr(a.colspan); props.rowSpan = intAttr(a.rowspan);
      } else if (tag === "ol") {
        props.start = intAttr(a.start);
      } else if (tag === "details") {
        if ("open" in a) props.open = true;
      } else if (tag === "col") {
        props.span = intAttr(a.span);
      }

      const Tag = tag as keyof React.JSX.IntrinsicElements;
      out.push(VOID.has(tag) ? <Tag key={key} {...props} /> : <Tag key={key} {...props}>{render(el.children, key, tag)}</Tag>);
    });
    return out;
  }

  return <div className={className}>{render(doc.children, "h")}</div>;
}

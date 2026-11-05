"use client";

import { useEffect, useRef } from "react";

/**
 * HTML "de página" (com <style>, classes, <html>…) mostrado do jeito que foi
 * desenhado, dentro de um iframe isolado.
 *
 * Segurança: sandbox SEM allow-scripts — nenhum <script>/on*= do conteúdo
 * roda — e CSP no documento bloqueando script e conexão. allow-same-origin
 * existe só pra este componente medir a altura, abrir link em aba nova e
 * ligar os checkboxes ao salvar (quem age é o código da página, não o HTML).
 * O CSS do conteúdo fica preso no iframe e não vaza pro LeadHub.
 */

const CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src https: data:; script-src 'none'; connect-src 'none'; form-action 'none'";

// Base do tema escuro do modal; o CSS do próprio conteúdo sobrescreve.
const BASE_CSS =
  "html{color-scheme:dark}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;" +
  "font-size:15px;line-height:1.6;color:#e2e8f0;background:transparent;overflow-wrap:anywhere}img{max-width:100%;height:auto}" +
  "a{color:#a5b4fc}table{border-collapse:collapse}";

function buildDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}</style></head><body>${html}</body></html>`;
}

export function HtmlFrame({ html, onToggleCheck, className }: {
  html: string;
  /** Índice do checkbox (ordem no texto) marcado/desmarcado no quadro. */
  onToggleCheck?: (index: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const toggleRef = useRef(onToggleCheck);
  useEffect(() => { toggleRef.current = onToggleCheck; });

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;

    function wire() {
      const doc = frame!.contentDocument;
      if (!doc?.documentElement) return;
      const fit = () => { frame!.style.height = `${doc.documentElement.scrollHeight}px`; };
      fit();
      ro?.disconnect();
      ro = new ResizeObserver(fit);
      ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);

      // Link externo abre em aba nova; âncora (#secao) rola o modal até ela.
      doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("#")) {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            const id = decodeURIComponent(href.slice(1));
            (doc.getElementById(id) ?? doc.getElementsByName(id)[0])?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        } else if (/^(https?:|mailto:|tel:)/i.test(href)) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        } else {
          a.removeAttribute("href");
        }
      });

      // Checkbox marca e salva no texto (mesma ordem do toggleHtmlCheck).
      doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb, i) => {
        if (!toggleRef.current) { cb.disabled = true; return; }
        cb.disabled = false;
        cb.addEventListener("change", () => toggleRef.current?.(i));
      });
    }

    frame.addEventListener("load", wire);
    if (frame.contentDocument?.readyState === "complete") wire();
    return () => { frame.removeEventListener("load", wire); ro?.disconnect(); };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Detalhamento"
      srcDoc={buildDoc(html)}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className={`w-full block border-0 min-h-[12rem] ${className ?? ""}`}
    />
  );
}

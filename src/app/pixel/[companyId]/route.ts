import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

// GET /pixel/[companyId].js — script de rastreamento (cole no <head> do site)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;

  const script = `
(function() {
  var ENDPOINT = "${BASE_URL}/api/pixel/event";

  // Lê utm_content da URL atual (código do link LeadHub)
  function getLinkCode() {
    try {
      var p = new URLSearchParams(window.location.search);
      return p.get('utm_content') || null;
    } catch(e) { return null; }
  }

  // Persiste o código na sessão para não perder entre navegações internas
  function getOrStoreCode() {
    var code = getLinkCode();
    if (code) {
      try { sessionStorage.setItem('_lh_code', code); } catch(e) {}
      return code;
    }
    try { return sessionStorage.getItem('_lh_code'); } catch(e) { return null; }
  }

  function send(targetUrl, targetLabel) {
    var code = getOrStoreCode();
    if (!code) return;
    try {
      var body = JSON.stringify({ linkCode: code, targetUrl: targetUrl, targetLabel: targetLabel });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function(){});
      }
    } catch(e) {}
  }

  // Extrai label rico do elemento clicado
  function getLabel(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 150);
  }

  // Detecta e decodifica mensagem de links WhatsApp
  // Formatos: https://wa.me/55...?text=... | https://api.whatsapp.com/send?phone=...&text=...
  function parseWhatsApp(href) {
    try {
      var url = new URL(href);
      var isWa = url.hostname === 'wa.me' || url.hostname === 'api.whatsapp.com' || url.hostname === 'web.whatsapp.com';
      if (!isWa) return null;
      var msg = decodeURIComponent(url.searchParams.get('text') || '');
      return { message: msg };
    } catch(e) { return null; }
  }

  // Sobe na árvore DOM para encontrar o <a> ou <button> pai
  function findClickable(el) {
    var node = el;
    while (node && node !== document.body) {
      var tag = (node.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button') return node;
      if (node.getAttribute && node.getAttribute('role') === 'button') return node;
      node = node.parentElement;
    }
    return null;
  }

  function handleClick(e) {
    var target = findClickable(e.target);
    if (!target) return;
    var tag = (target.tagName || '').toLowerCase();
    var href = target.href || target.getAttribute('href') || '';
    var label = getLabel(target);

    // WhatsApp: complementa o label com a mensagem pré-definida no link
    if (href) {
      var wa = parseWhatsApp(href);
      if (wa) {
        var waLabel = 'WhatsApp';
        if (wa.message) waLabel += ': ' + wa.message.slice(0, 100);
        else if (label) waLabel += ' — ' + label;
        send(href, waLabel);
        return;
      }
    }

    // Botão sem href ou link comum
    var prefix = (tag === 'button' || (target.getAttribute && target.getAttribute('role') === 'button')) ? 'Botão' : 'Link';
    var finalLabel = label ? prefix + ': ' + label : prefix;
    send(href || window.location.href, finalLabel);
  }

  function attach() {
    document.querySelectorAll('a[href], button, [role="button"]').forEach(function(el) {
      if (el.dataset.lhTracked) return;
      el.dataset.lhTracked = '1';
      el.addEventListener('click', handleClick, { passive: true });
    });
  }

  attach();
  if (window.MutationObserver) {
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  }
  getOrStoreCode();
})();
`.trim();

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

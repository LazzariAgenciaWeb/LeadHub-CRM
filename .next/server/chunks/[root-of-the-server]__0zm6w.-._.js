module.exports=[93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},70406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},25398,e=>{"use strict";var t=e.i(47909),r=e.i(74017),a=e.i(96250),n=e.i(59756),o=e.i(61916),i=e.i(74677),s=e.i(69741),l=e.i(16795),d=e.i(87718),u=e.i(95169),c=e.i(47587),p=e.i(66012),h=e.i(70101),g=e.i(26937),f=e.i(10372),x=e.i(93695);e.i(52474);var v=e.i(220),m=e.i(89171);let b=process.env.NEXT_PUBLIC_BASE_URL??"http://localhost:3000";async function w(e,{params:t}){let{companyId:r}=await t,a=`
(function() {
  var ENDPOINT = "${b}/api/pixel/event";

  // L\xea utm_content da URL atual (c\xf3digo do link LeadHub)
  function getLinkCode() {
    try {
      var p = new URLSearchParams(window.location.search);
      return p.get('utm_content') || null;
    } catch(e) { return null; }
  }

  // Persiste o c\xf3digo na sess\xe3o para n\xe3o perder entre navega\xe7\xf5es internas
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

  // Sobe na \xe1rvore DOM para encontrar o <a> ou <button> pai
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

    // WhatsApp: complementa o label com a mensagem pr\xe9-definida no link
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

    // Bot\xe3o sem href ou link comum
    var prefix = (tag === 'button' || (target.getAttribute && target.getAttribute('role') === 'button')) ? 'Bot\xe3o' : 'Link';
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
`.trim();return new m.NextResponse(a,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"public, max-age=3600","Access-Control-Allow-Origin":"*"}})}e.s(["GET",0,w],43253);var R=e.i(43253);let C=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/pixel/[companyId]/route",pathname:"/pixel/[companyId]",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/src/app/pixel/[companyId]/route.ts",nextConfigOutput:"standalone",userland:R,...{}}),{workAsyncStorage:y,workUnitAsyncStorage:E,serverHooks:A}=C;async function k(e,t,a){a.requestMeta&&(0,n.setRequestMeta)(e,a.requestMeta),C.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let m="/pixel/[companyId]/route";m=m.replace(/\/index$/,"")||"/";let b=await C.prepare(e,t,{srcPage:m,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:w,params:R,nextConfig:y,parsedUrl:E,isDraftMode:A,prerenderManifest:k,routerServerContext:N,isOnDemandRevalidate:T,revalidateOnlyGenerated:O,resolvedPathname:S,clientReferenceManifest:P,serverActionsManifest:_}=b,L=(0,s.normalizeAppPath)(m),I=!!(k.dynamicRoutes[L]||k.routes[S]),q=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,E,!1):t.end("This page could not be found"),null);if(I&&!A){let e=!!k.routes[S],t=k.dynamicRoutes[L];if(t&&!1===t.fallback&&!e){if(y.adapterPath)return await q();throw new x.NoFallbackError}}let U=null;!I||C.isDev||A||(U="/index"===(U=S)?"/":U);let j=!0===C.isDev||!I,D=I&&!j;_&&P&&(0,i.setManifestsSingleton)({page:m,clientReferenceManifest:P,serverActionsManifest:_});let H=e.method||"GET",M=(0,o.getTracer)(),B=M.getActiveScopeSpan(),W=!!(null==N?void 0:N.isWrappedByNextServer),$=!!(0,n.getRequestMeta)(e,"minimalMode"),F=(0,n.getRequestMeta)(e,"incrementalCache")||await C.getIncrementalCache(e,y,k,$);null==F||F.resetRequestCache(),globalThis.__incrementalCache=F;let K={params:R,previewProps:k.preview,renderOpts:{experimental:{authInterrupts:!!y.experimental.authInterrupts},cacheComponents:!!y.cacheComponents,supportsDynamicResponse:j,incrementalCache:F,cacheLifeProfiles:y.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>C.onRequestError(e,t,a,n,N)},sharedContext:{buildId:w}},G=new l.NodeNextRequest(e),X=new l.NodeNextResponse(t),V=d.NextRequestAdapter.fromNodeNextRequest(G,(0,d.signalFromNodeResponse)(t));try{let n,i=async e=>C.handle(V,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=M.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==u.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${H} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t),n&&n!==e&&(n.setAttribute("http.route",a),n.updateName(t))}else e.updateName(`${H} ${m}`)}),s=async n=>{var o,s;let l=async({previousCacheEntry:r})=>{try{if(!$&&T&&O&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await i(n);e.fetchMetrics=K.renderOpts.fetchMetrics;let s=K.renderOpts.pendingWaitUntil;s&&a.waitUntil&&(a.waitUntil(s),s=void 0);let l=K.renderOpts.collectedTags;if(!I)return await (0,p.sendResponse)(G,X,o,K.renderOpts.pendingWaitUntil),null;{let e=await o.blob(),t=(0,h.toNodeOutgoingHttpHeaders)(o.headers);l&&(t[f.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=f.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,a=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=f.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:v.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await C.onRequestError(e,t,{routerKind:"App Router",routePath:m,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,N),t}},d=await C.handleResponse({req:e,nextConfig:y,cacheKey:U,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:O,responseGenerator:l,waitUntil:a.waitUntil,isMinimalMode:$});if(!I)return null;if((null==d||null==(o=d.value)?void 0:o.kind)!==v.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(s=d.value)?void 0:s.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});$||t.setHeader("x-nextjs-cache",T?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),A&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let u=(0,h.fromNodeOutgoingHttpHeaders)(d.value.headers);return $&&I||u.delete(f.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||u.get("Cache-Control")||u.set("Cache-Control",(0,g.getCacheControlHeader)(d.cacheControl)),await (0,p.sendResponse)(G,X,new Response(d.value.body,{headers:u,status:d.value.status||200})),null};W&&B?await s(B):(n=M.getActiveScopeSpan(),await M.withPropagatedContext(e.headers,()=>M.trace(u.BaseServerSpan.handleRequest,{spanName:`${H} ${m}`,kind:o.SpanKind.SERVER,attributes:{"http.method":H,"http.target":e.url}},s),void 0,!W))}catch(t){if(t instanceof x.NoFallbackError||await C.onRequestError(e,t,{routerKind:"App Router",routePath:L,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,N),I)throw t;return await (0,p.sendResponse)(G,X,new Response(null,{status:500})),null}}e.s(["handler",0,k,"patchFetch",0,function(){return(0,a.patchFetch)({workAsyncStorage:y,workUnitAsyncStorage:E})},"routeModule",0,C,"serverHooks",0,A,"workAsyncStorage",0,y,"workUnitAsyncStorage",0,E],25398)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0zm6w.-._.js.map
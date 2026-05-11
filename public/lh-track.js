/*!
 * LeadHub — tracking de cliques internos
 *
 * Como usar (no site da proposta/landing, ex: azzagencia.com.br/propostas/sipeagri):
 *
 *   <script src="https://SEU-LEADHUB.com/lh-track.js" defer></script>
 *
 * Marque os botões/CTAs a rastrear com data-lh-track="nome-curto":
 *
 *   <a href="https://wa.me/55..." data-lh-track="cta-whatsapp">Falar com vendas</a>
 *   <button data-lh-track="orcamento">Solicitar orçamento</button>
 *
 * O script só dispara quando o visitante chega via /r/CODE do LeadHub
 * (parâmetro ?lh_ref=CODE adicionado automaticamente pelo redirect).
 * Sem código de referência, não envia nada — visitas orgânicas não inflam métricas.
 *
 * Cada clique vira um ClickEvent kind=INTERNAL e aparece como "Clique dentro
 * do link" na timeline do Lead vinculado.
 */
(function () {
  if (typeof window === "undefined") return;

  // Pega o code do ?lh_ref ou ?ref (apelido amigável)
  var params = new URLSearchParams(window.location.search);
  var code = params.get("lh_ref") || params.get("ref");
  if (!code) return;

  // Persiste o code em sessionStorage pra sobreviver a navegação interna
  // dentro da landing (cliente clica em CTA que vai pra outra página da
  // mesma proposta). Expira ao fechar a aba.
  try {
    sessionStorage.setItem("lh_ref", code);
  } catch (_) {}

  // BASE — onde está o LeadHub. Configurável via data-lh-base no <script>.
  var script = document.currentScript;
  var BASE =
    (script && script.getAttribute("data-lh-base")) ||
    "https://leadhub.lazzari.net.br";

  function track(button, url) {
    try {
      var current = code;
      try {
        current = sessionStorage.getItem("lh_ref") || code;
      } catch (_) {}
      fetch(BASE + "/api/track/" + encodeURIComponent(current) + "/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          button: String(button || "").slice(0, 120),
          url: String(url || window.location.href).slice(0, 500),
        }),
        keepalive: true, // sobrevive ao unload se cliente sair pra outro site
        credentials: "omit",
        mode: "cors",
      }).catch(function () {});
    } catch (_) {}
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      // Sobe na árvore até achar elemento com data-lh-track
      while (t && t !== document.body) {
        if (t.getAttribute && t.getAttribute("data-lh-track")) {
          var label =
            t.getAttribute("data-lh-track") ||
            (t.textContent || "").trim().slice(0, 60);
          var url = t.href || window.location.href;
          track(label, url);
          return;
        }
        t = t.parentNode;
      }
    },
    true // capture pra pegar antes do click navegar embora
  );
})();

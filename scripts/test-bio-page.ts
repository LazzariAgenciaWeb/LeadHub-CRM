/**
 * Página do Negócio: endereço da página e o corte de contatos visíveis no
 * plano grátis. Rodar: npm run test:bio-page
 */
import { slugifyBio, bioSlugProblem, visibleLeadCount, BIO_SLUG_MAX } from "../src/lib/bio-page";
import { PLANS, PAGE_LINE_TIERS, PLAN_ORDER } from "../src/lib/plans";

let falhas = 0;
function ok(nome: string, cond: boolean) {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}`);
}

// ── Endereço ──
ok("tira acento, espaço e pontuação", slugifyBio("Clínica São João!") === "clinica-sao-joao");
ok("junta separadores repetidos", slugifyBio("  Pet --  Shop  ") === "pet-shop");
ok("corta no máximo sem hífen sobrando",
  slugifyBio("a".repeat(BIO_SLUG_MAX - 1) + " bcd").length <= BIO_SLUG_MAX &&
  !slugifyBio("a".repeat(BIO_SLUG_MAX - 1) + " bcd").endsWith("-"));
ok("endereço válido passa", bioSlugProblem("clinica-sao-joao") === null);
ok("curto demais", bioSlugProblem("ab") === "curto");
ok("maiúscula/hífen duplo é formato inválido",
  bioSlugProblem("Clinica") === "formato" && bioSlugProblem("a--b") === "formato");
ok("rota do sistema é reservada", bioSlugProblem("admin") === "reservado" && bioSlugProblem("comecar") === "reservado");

// ── Contatos visíveis no grátis ──
const lim = PLANS.PAGINA.limits.leadsPerMonth;
ok("grátis mostra até 30", lim === 30);
ok("abaixo do limite mostra tudo", JSON.stringify(visibleLeadCount(12, lim)) === JSON.stringify({ visible: 12, hidden: 0 }));
ok("acima do limite esconde o excedente", JSON.stringify(visibleLeadCount(45, lim)) === JSON.stringify({ visible: 30, hidden: 15 }));
ok("Starter não esconde nada", visibleLeadCount(500, PLANS.STARTER.limits.leadsPerMonth).hidden === 0);

// ── Catálogo ──
ok("Página e Starter liberam o módulo", PAGE_LINE_TIERS.every((t) => PLANS[t].features.paginaNegocio));
ok("linha Página fica fora da pricing page do GoHub", PAGE_LINE_TIERS.every((t) => !PLAN_ORDER.includes(t)));
ok("Página é grátis e Starter custa 49,90", PLANS.PAGINA.priceMonthly === 0 && PLANS.STARTER.priceMonthly === 49.9);
ok("agenda só no Starter", !PLANS.PAGINA.features.calendario && PLANS.STARTER.features.calendario);

if (falhas) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nTudo certo.");

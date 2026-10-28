/**
 * Página do Negócio: endereço da página e o corte de contatos visíveis no
 * plano grátis. Rodar: npm run test:bio-page
 */
import type { BioEditorBlock, BioEditorInput } from "../src/lib/bio-page";
import { slugifyBio, bioSlugProblem, visibleLeadCount, safeBioHref, bioAccent, isBioClientEvent, parseBioEditorInput, parseBioSignup, bioAutosaveInput, referrerLabel, bioShowsBadge, BIO_SLUG_MAX } from "../src/lib/bio-page";
import { normalizeWaPhone } from "../src/lib/whatsapp-link-tool";
import { PLANS, PAGE_LINE_TIERS, PLAN_ORDER, type PlanTier } from "../src/lib/plans";

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

// ── Links e cor vindos do dono da página ──
ok("sem esquema ganha https", safeBioHref("meusite.com.br/contato") === "https://meusite.com.br/contato");
ok("javascript: é barrado", safeBioHref("javascript:alert(1)") === null && safeBioHref(" JavaScript:alert(1)") === null);
ok("data: é barrado", safeBioHref("data:text/html,oi") === null);
ok("mailto e tel passam", safeBioHref("mailto:a@b.com") === "mailto:a@b.com" && safeBioHref("tel:+5551999990000") === "tel:+5551999990000");
ok("vazio não vira link", safeBioHref("  ") === null && safeBioHref(null) === null);
ok("cor inválida cai no padrão", bioAccent("red;background:url(x)") === "#4f46e5" && bioAccent("#E11D48") === "#E11D48");
ok("LEAD não pode vir do navegador", !isBioClientEvent("LEAD") && isBioClientEvent("CLICK"));

// ── Editor ──
const base = {
  slug: "clinica-sorriso", title: "Clínica Sorriso", template: "VITRINE",
  blocks: [
    { type: "LINK", title: "Site", url: "clinica.com.br" },
    { type: "SERVICE", title: "Clareamento", priceLabel: "R$ 490" },
    { type: "SOCIAL", title: "Instagram", url: "instagram.com/x", network: "instagram" },
  ],
  questions: [{ text: "O que procura?", options: ["Estética", "Urgência", "Estética", " "] }],
};
const okParse = parseBioEditorInput(base);
ok("página válida passa", okParse.ok);
ok("resposta repetida/vazia é descartada", okParse.ok && okParse.data.questions[0].options.length === 2);
ok("serviço pode ficar sem link", okParse.ok && okParse.data.blocks[1].url === null);
ok("rede social de serviço é ignorada", okParse.ok && okParse.data.blocks[1].network === null);
ok("link sem endereço é recusado", !parseBioEditorInput({ ...base, blocks: [{ type: "LINK", title: "Site" }] }).ok);
ok("link javascript: é recusado", !parseBioEditorInput({ ...base, blocks: [{ type: "LINK", title: "X", url: "javascript:alert(1)" }] }).ok);
ok("pergunta com 1 resposta é recusada", !parseBioEditorInput({ ...base, questions: [{ text: "Oi?", options: ["Sim"] }] }).ok);
ok("endereço reservado é recusado", !parseBioEditorInput({ ...base, slug: "admin" }).ok);
ok("sem nome é recusado", !parseBioEditorInput({ ...base, title: "  " }).ok);
ok("imagem precisa ser http(s)", !parseBioEditorInput({ ...base, avatarUrl: "data:image/png;base64,xx" }).ok);
ok("mais de 5 perguntas é recusado", !parseBioEditorInput({ ...base, questions: Array(6).fill({ text: "P?", options: ["a", "b"] }) }).ok);

// ── Cadastro público ──
const signup = {
  businessName: "Pet Feliz", segment: "Pet", city: "Maripá", name: "Ana", email: "ANA@Exemplo.com ",
  phone: "(44) 99999-0001", password: "segredo123", acceptTerms: true, ref: "clinica-sorriso",
};
const sOk = parseBioSignup(signup, normalizeWaPhone);
ok("cadastro válido passa", sOk.ok);
ok("e-mail sai minúsculo e sem espaço", sOk.ok && sOk.data.email === "ana@exemplo.com");
ok("telefone sai com DDI", sOk.ok && sOk.data.phone === "5544999990001");
ok("sem aceitar termos é recusado", !parseBioSignup({ ...signup, acceptTerms: false }, normalizeWaPhone).ok);
ok("senha curta é recusada", !parseBioSignup({ ...signup, password: "123" }, normalizeWaPhone).ok);
ok("telefone sem DDD é recusado", !parseBioSignup({ ...signup, phone: "99999-0001" }, normalizeWaPhone).ok);
ok("indicação inválida é ignorada", (() => { const r = parseBioSignup({ ...signup, ref: "admin" }, normalizeWaPhone); return r.ok && r.data.ref === null; })());

// ── Origem da visita ──
ok("sem referrer é acesso direto", referrerLabel(null) === "Direto / app");
ok("subdomínio do Instagram vira instagram.com", referrerLabel("https://l.instagram.com/?u=x") === "instagram.com");
ok("domínio .com.br fica inteiro", referrerLabel("https://www.google.com.br/") === "google.com.br");
ok("referrer quebrado vira Outro", referrerLabel("não é url") === "Outro");

// ── Salvamento automático ──
const salvo: BioEditorInput = {
  slug: "studio-teste", template: "CARTAO", title: "Studio", headline: null, about: null,
  avatarUrl: null, coverUrl: null, accentColor: null, published: true, quizEnabled: true,
  quizTitle: null, quizCta: null, thankYouMessage: null, consentText: null,
  blocks: [{ id: "b1", type: "SERVICE", title: "Corte", description: null, url: null, imageUrl: null, priceLabel: null, network: null, active: true }],
  questions: [{ id: "q1", text: "Como ajudar?", options: ["A", "B"], active: true }],
};
const novoServico: BioEditorBlock = { type: "SERVICE", title: "", description: "rascunho", url: null, imageUrl: null, priceLabel: null, network: null, active: true };
const auto1 = bioAutosaveInput({ ...salvo, blocks: [{ ...salvo.blocks[0], description: "Com lavagem" }, novoServico] }, salvo);
ok("autosave grava o serviço completo e espera o novo sem nome",
  auto1.input.blocks.length === 1 && auto1.input.blocks[0].description === "Com lavagem" && auto1.pending.includes("Serviço sem nome"));
const auto2 = bioAutosaveInput({ ...salvo, blocks: [{ ...salvo.blocks[0], title: " " }] }, salvo);
ok("serviço salvo que perdeu o nome não é apagado", auto2.input.blocks.length === 1 && auto2.input.blocks[0].title === "Corte");
const auto3 = bioAutosaveInput({ ...salvo, slug: "outro-endereco", published: false }, salvo);
ok("endereço e publicação ficam fora do automático", auto3.input.slug === "studio-teste" && auto3.input.published === true);
const auto4 = bioAutosaveInput({ ...salvo, blocks: [...salvo.blocks, { ...novoServico, type: "LINK", title: "Site" }] }, salvo);
ok("link sem endereço espera", auto4.input.blocks.length === 1 && auto4.pending.some((p) => p.includes("falta o link")));
ok("o que o autosave monta passa na validação do servidor",
  [auto1, auto2, auto3, auto4].every((a) => parseBioEditorInput(a.input).ok));

// ── Catálogo ──
ok("Página e Starter liberam o módulo", PAGE_LINE_TIERS.every((t) => PLANS[t].features.paginaNegocio));
ok("linha Página fica fora da pricing page do GoHub", PAGE_LINE_TIERS.every((t) => !PLAN_ORDER.includes(t)));
ok("Página é grátis e Starter custa 49,90", PLANS.PAGINA.priceMonthly === 0 && PLANS.STARTER.priceMonthly === 49.9);
ok("Página do Negócio liberada em todos os planos", (Object.keys(PLANS) as PlanTier[]).every((t) => PLANS[t].features.paginaNegocio));
ok("selo só em quem não paga",
  bioShowsBadge("PAGINA") && bioShowsBadge("FREE") && bioShowsBadge(null) &&
  !bioShowsBadge("STARTER") && !bioShowsBadge("ESSENCIAL") && !bioShowsBadge("ENTERPRISE"));
ok("agenda só no Starter", !PLANS.PAGINA.features.calendario && PLANS.STARTER.features.calendario);

if (falhas) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nTudo certo.");

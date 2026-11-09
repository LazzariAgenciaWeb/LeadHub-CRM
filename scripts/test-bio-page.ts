/**
 * Página do Negócio: endereço da página e o corte de contatos visíveis no
 * plano grátis. Rodar: npm run test:bio-page
 */
import type { BioEditorBlock, BioEditorInput } from "../src/lib/bio-page";
import { pagePlanOf, slugifyBio, bioSlugProblem, visibleLeadCount, safeBioHref, bioAccent, isBioClientEvent, parseBioEditorInput, parseBioSignup, bioAutosaveInput, bioOnAccent, referrerLabel, bioShowsBadge, bioSnapshotAnswers, bioParseSocial, bioFreeView, BIO_FREE, bioTelHref, bioViewExtras, BIO_DEFAULT_BOOKING_TEXT, BIO_SLUG_MAX } from "../src/lib/bio-page";
import { normalizeWaPhone } from "../src/lib/whatsapp-link-tool";
import { PLANS, PAGE_LINE_TIERS, PLAN_ORDER, withPagePlan, type PlanTier } from "../src/lib/plans";
import { MODULE_BY_ID, resolveModules } from "../src/lib/modules";

let falhas = 0;
function ok(nome: string, cond: boolean) {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}`);
}

// ── Página como serviço adicional ──
ok("sem adicional, a página segue o plano principal", pagePlanOf({ plan: "MARKETING", pagePlan: null }) === "MARKETING");
ok("o adicional manda na página", pagePlanOf({ plan: "FREE", pagePlan: "PAGINA_PRO" }) === "PAGINA_PRO");
ok("Pro como adicional tira o selo do Free", !bioShowsBadge(pagePlanOf({ plan: "FREE", pagePlan: "PAGINA_PRO" })));
ok("adicional soma a agenda do Pro ao Free", withPagePlan(PLANS.FREE.features, "PAGINA_PRO").calendario === true);
ok("adicional nunca tira recurso do plano principal",
  (Object.keys(PLANS.PREMIUM.features) as (keyof typeof PLANS.PREMIUM.features)[])
    .every((k) => !PLANS.PREMIUM.features[k] || withPagePlan(PLANS.PREMIUM.features, "PAGINA")[k]));
ok("plano fora da linha Página não vira adicional", withPagePlan(PLANS.FREE.features, "PREMIUM" as PlanTier).whatsapp === PLANS.FREE.features.whatsapp);

// ── Botões da tela de módulos ──
for (const tier of Object.keys(PLANS) as PlanTier[]) {
  for (const m of resolveModules(tier, null)) {
    const def = MODULE_BY_ID[m.id];
    const custom: Record<string, boolean> = {};
    if (m.enabled) for (const k of [def.primary, ...(def.alsoEnabledBy ?? [])]) custom[k] = false;
    else custom[def.primary] = true;
    const after = resolveModules(tier, custom as any).find((x) => x.id === m.id)!;
    if (after.enabled === m.enabled) ok(`${tier}/${m.id} muda de estado`, false);
  }
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
  bookingUrl: null, bookingText: null, contactPhone: null, contactEmail: null, contactAddress: null, contactHours: null,
  blocks: [{ id: "b1", type: "SERVICE", title: "Corte", description: null, url: null, imageUrl: null, priceLabel: null, network: null, active: true }],
  questions: [{ id: "q1", text: "Como ajudar?", options: ["A", "B"], multiple: false, active: true }],
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

ok("texto escuro em cor clara, branco em cor escura",
  bioOnAccent("#2ae0d0") === "#0f172a" && bioOnAccent("#facc15") === "#0f172a" && bioOnAccent("#4f46e5") === "#ffffff" && bioOnAccent("#16a34a") === "#ffffff");

// ── Catálogo ──
ok("Grátis, Pro e Mini Site liberam o módulo", PAGE_LINE_TIERS.every((t) => PLANS[t].features.paginaNegocio));
ok("linha Página fica fora da pricing page do GoHub", PAGE_LINE_TIERS.every((t) => !PLAN_ORDER.includes(t)));
ok("preços iguais ao site: Grátis 0, Pro 29,90, Mini Site 59,90", PLANS.PAGINA.priceMonthly === 0 && PLANS.PAGINA_PRO.priceMonthly === 29.9 && PLANS.STARTER.priceMonthly === 59.9);
ok("anual = 10 meses (2 grátis)", PLANS.PAGINA_PRO.priceAnnualTotal === 299 && PLANS.STARTER.priceAnnualTotal === 599);
ok("nomes iguais ao site", PLANS.PAGINA.label === "Grátis" && PLANS.PAGINA_PRO.label === "Pro" && PLANS.STARTER.label === "Mini Site");
ok("Pro tira o selo e mostra todos os contatos", !bioShowsBadge("PAGINA_PRO") && PLANS.PAGINA_PRO.limits.leadsPerMonth === -1);
ok("Página do Negócio liberada em todos os planos", (Object.keys(PLANS) as PlanTier[]).every((t) => PLANS[t].features.paginaNegocio));
ok("selo só em quem não paga",
  bioShowsBadge("PAGINA") && bioShowsBadge("FREE") && bioShowsBadge(null) &&
  !bioShowsBadge("STARTER") && !bioShowsBadge("ESSENCIAL") && !bioShowsBadge("ENTERPRISE"));
ok("agenda só nos pagos", !PLANS.PAGINA.features.calendario && PLANS.PAGINA_PRO.features.calendario && PLANS.STARTER.features.calendario);

// ── Agenda e contato ──
const semExtras = { bookingUrl: null, bookingText: null, contactPhone: null, contactEmail: null, contactAddress: null, contactHours: null };
ok("sem agenda nem contato, nada aparece", (() => { const v = bioViewExtras(semExtras); return v.booking === null && v.contact === null; })());
ok("agenda com texto padrão e link saneado", (() => {
  const v = bioViewExtras({ ...semExtras, bookingUrl: "calendly.com/studio" });
  return v.booking?.href === "https://calendly.com/studio" && v.booking.text === BIO_DEFAULT_BOOKING_TEXT;
})());
ok("agenda com javascript: não aparece", bioViewExtras({ ...semExtras, bookingUrl: "javascript:alert(1)" }).booking === null);
ok("telefone vira tel: com DDI", bioTelHref("(11) 98888-7777") === "tel:+5511988887777" && bioTelHref("12") === null);
ok("endereço vira busca no Maps", bioViewExtras({ ...semExtras, contactAddress: "Rua A, 10" }).contact?.mapsHref?.includes("query=Rua%20A%2C%2010") === true);
ok("validação recusa e-mail de contato quebrado",
  !parseBioEditorInput({ ...salvo, contactEmail: "sem-arroba" }).ok && parseBioEditorInput({ ...salvo, contactEmail: "oi@studio.com" }).ok);
const auto5 = bioAutosaveInput({ ...salvo, bookingUrl: "javascript:x", contactPhone: "11 3333-4444" }, salvo);
ok("autosave grava o telefone e espera a agenda inválida",
  auto5.input.contactPhone === "11 3333-4444" && auto5.input.bookingUrl === null && auto5.pending.includes("Link da agenda inválido"));


// ── Respostas salvas etapa a etapa ──
const qs = [
  { id: "q1", text: "O que melhorar?", options: ["Instagram", "Google", "Site"], multiple: true },
  { id: "q2", text: "Quando?", options: ["Agora", "Depois"], multiple: false },
];
const snap = bioSnapshotAnswers(qs, [
  { questionId: "q1", answer: ["Site", "Instagram", "Inventado"] },
  { questionId: "q2", answer: ["Agora", "Depois"] },
  { questionId: "q9", answer: "x" },
]);
ok("respostas: ordem da pergunta, só opção que existe, única fica com uma",
  snap.length === 2 && snap[0].answer === "Instagram, Site" && snap[1].answer === "Agora");

// Campo livre "Instagram ou site"
{
  const a = bioParseSocial("@Loja.Bela");
  ok("social: @ vira instagram minúsculo", a.instagram === "loja.bela" && a.website === null);
  const b = bioParseSocial("https://www.instagram.com/lojabela/?hl=pt");
  ok("social: link do instagram vira usuário", b.instagram === "lojabela" && b.website === null);
  const c = bioParseSocial("lojabela.com.br");
  ok("social: domínio vira site com https", c.website === "https://lojabela.com.br" && c.instagram === null);
  const d = bioParseSocial("@lojabela, www.lojabela.com");
  ok("social: os dois juntos", d.instagram === "lojabela" && d.website === "https://www.lojabela.com");
  const e = bioParseSocial("joao.silva");
  ok("social: handle com ponto não vira site", e.instagram === "joao.silva" && e.website === null);
  const f = bioParseSocial("   ");
  ok("social: vazio é nulo", f.social === null && f.instagram === null && f.website === null);
  const g = bioParseSocial("não tenho ainda");
  ok("social: texto solto fica só no original", g.social === "não tenho ainda" && g.website === null && g.instagram === null);
}

// Limites do plano Grátis (o que o site promete)
{
  const view = {
    template: "VITRINE" as "CARTAO" | "VITRINE", accent: "#123456",
    blocks: [
      { type: "SOCIAL", imageUrl: null }, { type: "LINK", imageUrl: null }, { type: "SERVICE", imageUrl: "https://x/img.jpg" },
      { type: "LINK", imageUrl: null }, { type: "LINK", imageUrl: null }, { type: "SOCIAL", imageUrl: null },
      { type: "LINK", imageUrl: null }, { type: "LINK", imageUrl: null }, { type: "SERVICE", imageUrl: null },
    ],
    booking: { href: "https://cal.com/x", text: "Agende" },
    quiz: { title: "q" },
  };
  const f = bioFreeView(view);
  ok("grátis: até 5 botões, redes sociais à parte", f.blocks.filter((b) => b.type !== "SOCIAL").length === BIO_FREE.buttons && f.blocks.filter((b) => b.type === "SOCIAL").length === 2);
  ok("grátis: serviço sem imagem", f.blocks.every((b) => b.imageUrl === null));
  ok("grátis: sem agenda e sem formulário", f.booking === null && f.quiz === null);
  ok("grátis: modelo Cartão e cor fora das 3 volta pra padrão", f.template === "CARTAO" && f.accent === BIO_FREE.colors[0]);
  ok("grátis: cor permitida fica", bioFreeView({ ...view, accent: "#E11D48" }).accent === "#E11D48");
  ok("grátis: não mexe no original", view.blocks.length === 9 && view.quiz !== null);
}

ok("Mini Site leva os leads pro CRM; Grátis e Pro não", PLANS.STARTER.features.crmPipelineLeads && !PLANS.PAGINA_PRO.features.crmPipelineLeads && !PLANS.PAGINA.features.crmPipelineLeads);
ok("site sem 'até 3 páginas'", !PLANS.STARTER.highlights.some((h) => /3 páginas/.test(h)));

if (falhas) {
  console.error(`\n${falhas} falha(s)`);
  process.exit(1);
}

console.log("\nTudo certo.");

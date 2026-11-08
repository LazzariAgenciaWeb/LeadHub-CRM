import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, extractIp } from "@/lib/webhook-auth";
import { normalizeWaPhone } from "@/lib/whatsapp-link-tool";
import { parseBioSignup } from "@/lib/bio-page";
import { prisma } from "@/lib/prisma";
import { createLoginHandoff } from "@/lib/login-handoff";
import { pageLinePlanFromSlug } from "@/lib/plans";
import {
  EmailTakenError,
  appBase,
  createBioSignup,
  recordSignupLead,
  resolveAgencyCompanyId,
  sendBioWelcome,
} from "@/lib/bio-page-server";

export const runtime = "nodejs";

// POST /api/comecar
// Cadastro público do plano grátis da Página do Negócio. Cria empresa (sub da
// agência), assinatura PAGINA, usuário ADMIN e o rascunho da página; registra
// o lead no CRM da agência e manda o e-mail de boas-vindas.
// O cadastro pode rodar em gohub.com.br (Worker) e o painel em outro domínio:
// a resposta traz `next` = /entrar do painel com um código de uso único, que
// faz o login lá sem pedir a senha de novo.
export async function POST(req: NextRequest) {
  const ip = extractIp(req);
  if (!checkRateLimit(`comecar:${ip}`, 5, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo mais tarde." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  // Campo-armadilha: robô preenche, gente não vê. Finge sucesso sem criar nada.
  if (body && typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const parsed = parseBioSignup(body, normalizeWaPhone);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.data;

  const agencyId = await resolveAgencyCompanyId();
  let created: Awaited<ReturnType<typeof createBioSignup>>;
  try {
    created = await createBioSignup(input, agencyId);
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return NextResponse.json(
        { error: "Já existe uma conta com este e-mail. Entre pelo login ou use \"Esqueci minha senha\".", emailTaken: true },
        { status: 409 },
      );
    }
    throw e;
  }

  // Lead da agência e e-mail não podem derrubar o cadastro: a conta já existe.
  const meta = { ip: ip === "unknown" ? null : ip, userAgent: req.headers.get("user-agent")?.slice(0, 500) || null };
  await Promise.all([
    agencyId
      ? recordSignupLead(agencyId, input, created.pageSlug, meta).catch((e) => console.error("[comecar] lead da agência", e))
      : Promise.resolve(console.error("[comecar] sem agência: cadastro sem lead")),
    sendBioWelcome(input, created.pageSlug).catch((e) => console.error("[comecar] e-mail de boas-vindas", e)),
  ]);

  // Sem o código, o navegador cai no login normal — a conta já existe.
  let next: string | null = null;
  try {
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    // Veio pelo botão "Começar com o Pro"/"Escolher Negócio" do site: depois
    // do login o editor já abre o pagamento desse plano.
    const assinar = pageLinePlanFromSlug(body?.plano);
    if (user) next = `${appBase()}/entrar#t=${await createLoginHandoff(user.id)}${assinar ? `&assinar=${assinar}` : ""}`;
  } catch (e) {
    console.error("[comecar] código de entrada", e);
  }

  return NextResponse.json({ ok: true, email: input.email, next }, { status: 201 });
}

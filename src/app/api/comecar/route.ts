import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, extractIp } from "@/lib/webhook-auth";
import { normalizeWaPhone } from "@/lib/whatsapp-link-tool";
import { parseBioSignup } from "@/lib/bio-page";
import {
  EmailTakenError,
  createBioSignup,
  recordSignupLead,
  resolveAgencyCompanyId,
  sendBioWelcome,
} from "@/lib/bio-page-server";

export const runtime = "nodejs";

// POST /api/comecar
// Cadastro público do plano grátis da Página do Negócio. Cria empresa (sub da
// agência), assinatura PAGINA, usuário ADMIN e o rascunho da página; registra
// o lead no CRM da agência e manda o e-mail de boas-vindas. O navegador entra
// em seguida com o e-mail e a senha (signIn de credentials).
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

  return NextResponse.json({ ok: true, email: input.email }, { status: 201 });
}

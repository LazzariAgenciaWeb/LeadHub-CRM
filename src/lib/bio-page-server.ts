import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import {
  BIO_DEFAULT_QUESTIONS,
  BIO_PUBLIC_PATH,
  BIO_SIGNUP_SOURCE,
  bioSlugProblem,
  slugifyBio,
  type BioEditorInput,
  type BioSignupInput,
} from "@/lib/bio-page";

// Lado servidor da Página do Negócio: quem pode editar, criação do rascunho
// e o salvamento (que preserva os ids dos blocos — os cliques registrados em
// BioEvent apontam pra eles).

type EditorAuth =
  | { ok: true; companyId: string }
  | { ok: false; response: NextResponse };

/** ADMIN da empresa (ou super admin visualizando como ela) com o módulo liberado. */
export async function requireBioEditor(): Promise<EditorAuth> {
  const session = await getEffectiveSession();
  if (!session) return { ok: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const role = (session.user as any)?.role as string | undefined;
  const companyId = (session.user as any)?.companyId as string | undefined;
  if (!companyId) {
    return { ok: false, response: NextResponse.json({ error: "Entre como a empresa para editar a página dela." }, { status: 400 }) };
  }
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { ok: false, response: NextResponse.json({ error: "Só o administrador da empresa edita a página." }, { status: 403 }) };
  }
  const gate = await assertModule(session, "paginaNegocio");
  if (!gate.ok) return { ok: false, response: gate.response };
  return { ok: true, companyId };
}

/** Primeiro endereço livre a partir do nome: "clinica", "clinica-2", "clinica-3"… */
async function freeSlug(seed: string): Promise<string> {
  let base = slugifyBio(seed);
  if (bioSlugProblem(base)) base = slugifyBio(`${base}-pagina`);
  if (bioSlugProblem(base)) base = "minha-pagina";
  for (let n = 1; n < 500; n++) {
    const candidate = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (bioSlugProblem(candidate)) continue;
    const taken = await prisma.bioPage.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

/**
 * Página da empresa; cria o rascunho na primeira vez, já preenchido com o que
 * o cadastro tem (nome, logo, cor) e as perguntas padrão.
 */
export async function ensureBioPage(companyId: string) {
  const existing = await prisma.bioPage.findUnique({ where: { companyId }, select: { id: true } });
  if (existing) return existing.id;

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, tradeName: true, slug: true, logoUrl: true, brandColor: true },
  });
  const title = company.tradeName ?? company.name;
  // Duas requisições na primeira visita (render + API) podem chegar juntas:
  // quem perder a corrida pela unique de companyId usa a que já foi criada.
  const page = await prisma.bioPage.create({
    data: {
      companyId,
      slug: await freeSlug(title || company.slug),
      title,
      avatarUrl: company.logoUrl,
      accentColor: company.brandColor && /^#[0-9a-f]{6}$/i.test(company.brandColor) ? company.brandColor : null,
      questions: {
        create: BIO_DEFAULT_QUESTIONS.map((q, order) => ({ text: q.text, options: q.options, order })),
      },
    },
    select: { id: true },
  }).catch(async (e: { code?: string }) => {
    if (e?.code !== "P2002") throw e;
    return prisma.bioPage.findUniqueOrThrow({ where: { companyId }, select: { id: true } });
  });
  return page.id;
}

export async function loadEditorPage(companyId: string) {
  return prisma.bioPage.findUniqueOrThrow({
    where: { companyId },
    include: {
      blocks: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      questions: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });
}

export type EditorPage = Awaited<ReturnType<typeof loadEditorPage>>;

/** Formato que o editor recebe e devolve (mesmo do parseBioEditorInput). */
export function toEditorInput(page: EditorPage): BioEditorInput & { id: string; publishedAt: string | null } {
  return {
    id: page.id,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    slug: page.slug,
    template: page.template,
    title: page.title,
    headline: page.headline,
    about: page.about,
    avatarUrl: page.avatarUrl,
    coverUrl: page.coverUrl,
    accentColor: page.accentColor,
    published: page.published,
    quizEnabled: page.quizEnabled,
    quizTitle: page.quizTitle,
    quizCta: page.quizCta,
    thankYouMessage: page.thankYouMessage,
    consentText: page.consentText,
    blocks: page.blocks.map((b) => ({
      id: b.id, type: b.type, title: b.title, description: b.description, url: b.url,
      imageUrl: b.imageUrl, priceLabel: b.priceLabel, network: b.network, active: b.active,
    })),
    questions: page.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, multiple: q.multiple, active: q.active })),
  };
}

export class SlugTakenError extends Error {}

/**
 * Grava tudo de uma vez. Blocos e perguntas com id desta página são
 * atualizados (o id fica — é nele que os cliques/respostas se apoiam), os
 * novos são criados e os que sumiram da lista são apagados. A ordem é a da
 * lista recebida.
 */
export async function saveBioPage(pageId: string, data: BioEditorInput) {
  const taken = await prisma.bioPage.findFirst({
    where: { slug: data.slug, NOT: { id: pageId } },
    select: { id: true },
  });
  if (taken) throw new SlugTakenError();

  const current = await prisma.bioPage.findUniqueOrThrow({
    where: { id: pageId },
    select: {
      published: true,
      publishedAt: true,
      blocks: { select: { id: true } },
      questions: { select: { id: true } },
    },
  });
  const blockIds = new Set(current.blocks.map((b) => b.id));
  const questionIds = new Set(current.questions.map((q) => q.id));
  const keepBlocks = data.blocks.map((b) => b.id).filter((id): id is string => !!id && blockIds.has(id));
  const keepQuestions = data.questions.map((q) => q.id).filter((id): id is string => !!id && questionIds.has(id));

  await prisma.$transaction([
    prisma.bioPage.update({
      where: { id: pageId },
      data: {
        slug: data.slug,
        template: data.template,
        title: data.title,
        headline: data.headline,
        about: data.about,
        avatarUrl: data.avatarUrl,
        coverUrl: data.coverUrl,
        accentColor: data.accentColor,
        published: data.published,
        // Data da PRIMEIRA publicação — despublicar e voltar não reinicia.
        publishedAt: data.published ? current.publishedAt ?? new Date() : current.publishedAt,
        quizEnabled: data.quizEnabled,
        quizTitle: data.quizTitle,
        quizCta: data.quizCta,
        thankYouMessage: data.thankYouMessage,
        consentText: data.consentText,
      },
    }),
    prisma.bioBlock.deleteMany({ where: { pageId, id: { notIn: keepBlocks } } }),
    prisma.bioQuestion.deleteMany({ where: { pageId, id: { notIn: keepQuestions } } }),
    ...data.blocks.map((b, order) => {
      const fields = {
        type: b.type, title: b.title, description: b.description, url: b.url,
        imageUrl: b.imageUrl, priceLabel: b.priceLabel, network: b.network, active: b.active, order,
      };
      return b.id && blockIds.has(b.id)
        ? prisma.bioBlock.update({ where: { id: b.id }, data: fields })
        : prisma.bioBlock.create({ data: { pageId, ...fields } });
    }),
    ...data.questions.map((q, order) => {
      const fields = { text: q.text, options: q.options, multiple: q.multiple, active: q.active, order };
      return q.id && questionIds.has(q.id)
        ? prisma.bioQuestion.update({ where: { id: q.id }, data: fields })
        : prisma.bioQuestion.create({ data: { pageId, ...fields } });
    }),
  ]);
}

// ─── Cadastro público ────────────────────────────────────────────────────────

/**
 * Agência dona da linha Página: as empresas do cadastro grátis nascem como
 * sub-empresa dela e cada cadastro vira lead no CRM dela. PAGINA_AGENCY_COMPANY_ID
 * manda; sem ele, a empresa-raiz com mais clientes (a agência, na prática).
 */
export async function resolveAgencyCompanyId(): Promise<string | null> {
  const fromEnv = process.env.PAGINA_AGENCY_COMPANY_ID?.trim();
  if (fromEnv) {
    const ok = await prisma.company.findUnique({ where: { id: fromEnv }, select: { id: true } });
    if (ok) return ok.id;
    console.error("[pagina] PAGINA_AGENCY_COMPANY_ID não existe:", fromEnv);
  }
  const roots = await prisma.company.findMany({
    where: { parentCompanyId: null, status: "ACTIVE" },
    select: { id: true, _count: { select: { subCompanies: true } } },
  });
  roots.sort((a, b) => b._count.subCompanies - a._count.subCompanies);
  return roots[0]?.id ?? null;
}

export class EmailTakenError extends Error {}

function publicBase(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

async function freeCompanySlug(seed: string): Promise<string> {
  const base = slugifyBio(seed) || "empresa";
  for (let n = 1; n < 500; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.company.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Cria a conta do cadastro grátis: empresa (sub da agência) + assinatura
 * PAGINA + usuário ADMIN + rascunho da página. Devolve o endereço da página.
 */
export async function createBioSignup(input: BioSignupInput, agencyId: string | null) {
  const taken = await prisma.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (taken) throw new EmailTakenError();

  const referrer = input.ref
    ? await prisma.bioPage.findUnique({ where: { slug: input.ref }, select: { id: true } })
    : null;
  const password = await bcrypt.hash(input.password, 10);
  const slug = await freeCompanySlug(input.businessName);

  const company = await prisma.$transaction(async (tx) => {
    const c = await tx.company.create({
      data: {
        name: input.businessName,
        slug,
        segment: input.segment,
        phone: input.phone,
        email: input.email,
        parentCompanyId: agencyId,
      },
      select: { id: true },
    });
    await tx.subscription.create({ data: { companyId: c.id, plan: "PAGINA", status: "ACTIVE" } });
    await tx.user.create({
      data: { name: input.name, email: input.email, password, role: "ADMIN", companyId: c.id },
    });
    return c;
  }).catch((e: { code?: string }) => {
    // Duas abas mandando o mesmo e-mail ao mesmo tempo: a unique do User decide.
    if (e?.code === "P2002") throw new EmailTakenError();
    throw e;
  });

  const pageId = await ensureBioPage(company.id);
  const page = await prisma.bioPage.update({
    where: { id: pageId },
    data: { headline: `${input.segment} em ${input.city}`, referredById: referrer?.id ?? null },
    select: { slug: true },
  });
  return { companyId: company.id, pageSlug: page.slug, referred: !!referrer };
}

/** Lead no CRM da agência: quem se cadastra no grátis é quem tem interesse em site. */
export async function recordSignupLead(agencyId: string, input: BioSignupInput, pageSlug: string, req: { ip: string | null; userAgent: string | null }) {
  const lines = [
    "Cadastrou-se na Página do Negócio (grátis).",
    `Negócio: ${input.businessName} — ${input.segment} — ${input.city}`,
    `Página: ${publicBase()}${BIO_PUBLIC_PATH}/${pageSlug}`,
    input.ref ? `Veio pelo selo da página /p/${input.ref}` : null,
  ].filter(Boolean);
  const note = lines.join("\n");

  const existing = await prisma.lead.findFirst({
    where: { companyId: agencyId, phone: input.phone },
    orderBy: { createdAt: "desc" },
    select: { id: true, notes: true, email: true },
  });
  if (existing) {
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        email: existing.email || input.email,
        notes: existing.notes ? `${existing.notes}\n\n${note}` : note,
      },
    });
    return;
  }
  const firstStage = await prisma.pipelineStageConfig.findFirst({
    where: { companyId: agencyId, pipeline: "LEADS" },
    orderBy: { order: "asc" },
    select: { name: true },
  });
  await prisma.lead.create({
    data: {
      companyId: agencyId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      source: BIO_SIGNUP_SOURCE,
      status: "NEW",
      pipeline: "LEADS",
      pipelineStage: firstStage?.name ?? null,
      notes: note,
      clientIp: req.ip,
      clientUserAgent: req.userAgent,
    },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendBioWelcome(input: BioSignupInput, pageSlug: string) {
  const base = publicBase();
  const editor = `${base}/pagina`;
  const pageUrl = `${base}${BIO_PUBLIC_PATH}/${pageSlug}`;
  const first = esc(input.name.split(" ")[0] ?? "");
  await sendMail({
    to: input.email,
    subject: "Sua Página do Negócio está pronta para montar",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2733">
        <h2 style="margin:0 0 6px">Bem-vindo${first ? `, ${first}` : ""}!</h2>
        <p style="color:#5b6470;font-size:14px;line-height:1.6">A página de <strong>${esc(input.businessName)}</strong> já foi criada como rascunho. Em poucos minutos você coloca foto, serviços e as perguntas que transformam visita em contato — e publica.</p>
        <p style="margin:22px 0">
          <a href="${editor}" style="background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;display:inline-block">Montar minha página</a>
        </p>
        <p style="color:#5b6470;font-size:14px;line-height:1.6">Depois de publicar, ela fica neste endereço — é o link que vai na bio do Instagram e no WhatsApp:<br><a href="${pageUrl}" style="color:#4f46e5">${pageUrl}</a></p>
        <p style="color:#8a929e;font-size:12.5px;line-height:1.6">Para entrar de novo, use este e-mail (${esc(input.email)}) e a senha que você criou. Esqueceu? Use "Esqueci minha senha" na tela de login.</p>
      </div>`,
  });
}

/**
 * Painel detalhado das páginas: SUPER_ADMIN ou ADMIN da agência dona da
 * linha. Olha a sessão REAL — visualizando como cliente, o super admin
 * continua podendo abrir o painel.
 */
export async function canSeeBioAdmin(): Promise<boolean> {
  const real = await getServerSession(authOptions);
  const role = (real?.user as any)?.role as string | undefined;
  if (role === "SUPER_ADMIN") return true;
  if (role !== "ADMIN") return false;
  const companyId = (real?.user as any)?.companyId as string | undefined;
  return !!companyId && companyId === (await resolveAgencyCompanyId());
}

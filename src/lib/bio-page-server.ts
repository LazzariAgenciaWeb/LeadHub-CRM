import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveSession } from "@/lib/effective-session";
import { assertModule } from "@/lib/billing";
import {
  BIO_DEFAULT_QUESTIONS,
  bioSlugProblem,
  slugifyBio,
  type BioEditorInput,
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
    questions: page.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, active: q.active })),
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
      const fields = { text: q.text, options: q.options, active: q.active, order };
      return q.id && questionIds.has(q.id)
        ? prisma.bioQuestion.update({ where: { id: q.id }, data: fields })
        : prisma.bioQuestion.create({ data: { pageId, ...fields } });
    }),
  ]);
}

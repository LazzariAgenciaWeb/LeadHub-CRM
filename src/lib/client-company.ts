/**
 * Helper para resolver/criar empresas-cliente em chamados.
 *
 * Quando se cria um chamado pra um cliente que ainda não existe no sistema,
 * este helper:
 *   1. Busca empresa pelo nome (case-insensitive) sob a empresa-pai (agência)
 *   2. Se não achar, cria nova com parentCompanyId apontando pra agência
 *   3. Devolve sempre o ID da empresa-cliente
 */

import { prisma } from "./prisma";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base || `cliente-${Date.now()}`;
  let n = 0;
  while (await prisma.company.findUnique({ where: { slug } })) {
    n++;
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * Encontra ou cria a empresa-cliente. parentCompanyId é a agência (a Company
 * que está abrindo o chamado). Retorna o ID do cliente.
 */
export async function findOrCreateClientCompany(opts: {
  name: string;
  phone?: string | null;
  email?: string | null;
  parentCompanyId: string;
}): Promise<string> {
  const name = opts.name.trim();
  if (!name) throw new Error("Nome do cliente é obrigatório");

  // 1. Tenta achar por nome exato (case-insensitive) sob a mesma agência
  const existing = await prisma.company.findFirst({
    where: {
      parentCompanyId: opts.parentCompanyId,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  // 2. Cria novo
  const slug = await uniqueSlug(slugify(name));
  const created = await prisma.company.create({
    data: {
      name,
      slug,
      phone: opts.phone || null,
      email: opts.email || null,
      parentCompanyId: opts.parentCompanyId,
      hasSystemAccess: false,  // cliente novo não loga no portal por default
    },
    select: { id: true },
  });
  return created.id;
}

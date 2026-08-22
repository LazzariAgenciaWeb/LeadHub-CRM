import { NextResponse } from "next/server";
import { prisma } from "./prisma";

/**
 * Portal do cliente (área /meu-espaco) — guarda de escrita.
 *
 * O discriminador NÃO é o role: `CLIENT` no LeadHub é o atendente da agência,
 * não o cliente final (ver AGENTS.md). Quem está no portal é o usuário de uma
 * SUB-EMPRESA — empresa com `parentCompanyId` preenchido. É o mesmo critério
 * usado pelo layout de (cliente).
 *
 * Isso importa porque `authorizeVaultAccess` devolve `canWrite: true` para
 * usuário agindo na própria empresa, inclusive o do portal. Sem esta guarda, o
 * cliente que abre o próprio relatório conseguiria disparar sync e mudar quais
 * eventos contam como conversão — ou seja, editar os próprios números.
 */
export async function isClientPortalUser(session: any): Promise<boolean> {
  const u = session?.user as any;
  const role = u?.role as string | undefined;
  const companyId = u?.companyId as string | undefined;
  if (!companyId || role === "SUPER_ADMIN") return false;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true },
  });
  return !!company?.parentCompanyId;
}

/**
 * Retorna uma resposta 403 quando o usuário é do portal do cliente; `null`
 * quando pode seguir. Use no início de qualquer rota de ESCRITA de marketing:
 *
 *   const blocked = await blockClientPortalWrite(session);
 *   if (blocked) return blocked;
 */
export async function blockClientPortalWrite(session: any): Promise<NextResponse | null> {
  if (await isClientPortalUser(session)) {
    return NextResponse.json(
      { error: "Seu acesso ao relatório é somente leitura. Fale com a agência." },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Popula a carteira local: empresas-cliente da agência, contratos recorrentes
 * com valor e um punhado de cobranças — sem isso a tela /financeiro nasce
 * zerada e não dá pra avaliar nada.
 *
 * NÃO roda fora de localhost.
 *
 * Uso:
 *   npx tsx scripts/seed-financeiro-demo.ts [--reset]
 */

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const RESET = process.argv.includes("--reset");

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Abortado: este seed é só pra banco local.");
  process.exit(1);
}

const now = new Date();
const compet = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Contrato = {
  label: string;
  amountCents: number;
  cycle: "MENSAL" | "TRIMESTRAL" | "ANUAL";
  /** meses a partir de agora pra ancorar o ciclo não-mensal */
  anchorOffset?: number;
  /** já tem cobrança lançada na competência? */
  faturado?: boolean;
  /** cobrança já paga? (implica faturado) */
  pago?: boolean;
  /** cobrança vencida e não paga? */
  atrasado?: boolean;
};

const CARTEIRA: { cliente: string; contratos: Contrato[] }[] = [
  {
    cliente: "Clínica Vida Plena",
    contratos: [
      { label: "Hospedagem site principal", amountCents: 15000, cycle: "MENSAL", faturado: true, pago: true },
      { label: "Gestão de mídias sociais", amountCents: 120000, cycle: "MENSAL", faturado: true, pago: true },
    ],
  },
  {
    cliente: "Auto Center Rodas",
    contratos: [
      { label: "Hospedagem", amountCents: 15000, cycle: "MENSAL", faturado: true, atrasado: true },
      { label: "Gestão de tráfego pago", amountCents: 90000, cycle: "MENSAL" },
    ],
  },
  {
    cliente: "Imobiliária Terra Nova",
    contratos: [
      { label: "Marketing completo", amountCents: 250000, cycle: "MENSAL" },
      { label: "Licença do site (anual)", amountCents: 480000, cycle: "ANUAL", anchorOffset: 0 },
    ],
  },
  {
    cliente: "Escola Semear",
    contratos: [
      { label: "Gestão de mídias sociais", amountCents: 140000, cycle: "MENSAL", faturado: true },
      { label: "Consultoria estratégica", amountCents: 240000, cycle: "TRIMESTRAL", anchorOffset: -1 },
    ],
  },
  {
    cliente: "Petshop Focinho Feliz",
    contratos: [
      { label: "Hospedagem + e-mail", amountCents: 19000, cycle: "MENSAL" },
    ],
  },
];

async function main() {
  const agency = await prisma.company.findFirst({
    where: { parentCompanyId: null },
    orderBy: { createdAt: "asc" },
  });
  if (!agency) throw new Error("Nenhuma agência no banco local.");
  console.log(`Agência: ${agency.name}`);

  if (RESET) {
    const subs = await prisma.company.findMany({ where: { parentCompanyId: agency.id }, select: { id: true } });
    const ids = subs.map((s) => s.id);
    await prisma.clientInvoice.deleteMany({ where: { clientCompanyId: { in: ids } } });
    await prisma.clientService.deleteMany({ where: { clientCompanyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
    console.log(`Removidos ${ids.length} cliente(s) e seus contratos.`);
  }

  let contratos = 0;
  let cobrancas = 0;

  for (const { cliente, contratos: lista } of CARTEIRA) {
    const slug = `${slugify(cliente)}-demo`;
    const company = await prisma.company.upsert({
      where: { slug },
      create: { name: cliente, slug, parentCompanyId: agency.id, status: "ACTIVE" },
      update: { parentCompanyId: agency.id },
    });

    for (const ct of lista) {
      const renewsAt =
        ct.cycle === "MENSAL"
          ? null
          : new Date(now.getFullYear(), now.getMonth() + (ct.anchorOffset ?? 0), 10);

      const svc = await prisma.clientService.create({
        data: {
          clientCompanyId: company.id,
          label: ct.label,
          status: "ATIVO",
          isRecurring: true,
          amountCents: ct.amountCents,
          billingCycle: ct.cycle,
          billingDay: 10,
          renewsAt,
        },
      });
      contratos++;

      if (ct.faturado || ct.pago || ct.atrasado) {
        const vencido = !!ct.atrasado;
        await prisma.clientInvoice.create({
          data: {
            clientCompanyId: company.id,
            clientServiceId: svc.id,
            description: ct.label,
            referenceMonth: compet,
            amountCents: ct.amountCents,
            dueDate: vencido
              ? new Date(now.getFullYear(), now.getMonth(), 1)
              : new Date(now.getFullYear(), now.getMonth(), 25),
            status: ct.pago ? "PAGO" : "ABERTO",
            paidAt: ct.pago ? new Date(now.getFullYear(), now.getMonth(), 8) : null,
            provider: "manual",
          },
        });
        cobrancas++;
      }
    }
  }

  console.log(`${CARTEIRA.length} clientes · ${contratos} contratos · ${cobrancas} cobranças (competência ${compet}).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

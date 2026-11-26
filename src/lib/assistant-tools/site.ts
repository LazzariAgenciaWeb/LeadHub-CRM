import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { recordAdminAction } from "@/lib/admin-audit";
import { CpanelError, uploadCpanelFiles } from "@/lib/cpanel";
import { type ToolDef, ok, fail, appUrl } from "./types";

/**
 * Publicar no site (cPanel) pelo assistente.
 *
 * Uso típico: o assistente monta um orçamento/proposta em HTML, publica na
 * pasta de publicação do cPanel (Configurações → Integrações → cPanel, ou o
 * cadastro do cliente) e já cria o link rastreável /r/CÓDIGO apontando pra ele
 * — o mesmo dos "Links" do sistema, com contagem de cliques e "proposta
 * encerrada" quando desativado.
 *
 * Travas: só ADMIN; só a própria empresa ou cliente da carteira; tudo preso à
 * pasta de publicação; nunca substitui arquivo sem `substituir: true`.
 */

const MAX_CHARS = 2_000_000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

async function newLinkCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const len = attempt < 10 ? 7 : 10;
    const code = Array.from({ length: len }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    if (!(await prisma.trackingLink.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error("não consegui gerar um código de link livre");
}

const MIME: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", txt: "text/plain", xml: "application/xml", svg: "image/svg+xml",
};

export const publicarNoSite: ToolDef<{
  clientCompanyId?: string; pasta?: string; arquivo?: string; conteudo: string;
  substituir?: boolean; criarLink?: boolean; titulo?: string; descricao?: string;
}> = {
  name: "publicar_no_site",
  description:
    "Publica um arquivo de TEXTO (HTML de orçamento/proposta/landing page, ou CSS/JS/JSON/SVG) na hospedagem cPanel, dentro da pasta de publicação configurada, e por padrão já cria o link rastreável /r/CÓDIGO apontando pra ele (o mesmo dos Links do sistema: conta cliques e pode ser encerrado depois). " +
    "Sem clientCompanyId publica na hospedagem da PRÓPRIA empresa (Configurações → Integrações → cPanel); com clientCompanyId (de buscar_cliente), na do cliente. " +
    "Pra orçamento: HTML completo e autocontido (CSS no <style>, imagens por URL absoluta), um arquivo com nome único e sem acento (ex.: orcamento-padaria-joao-2026-11.html) ou pasta própria com index.html. " +
    "Se o arquivo já existir, NADA é trocado e a resposta avisa: confirme com o usuário antes de repetir com substituir=true. " +
    "Devolve a URL direta e o link curto pra mandar ao cliente.",
  input_schema: {
    type: "object",
    properties: {
      clientCompanyId: { type: "string", description: "Omitir = hospedagem da própria empresa." },
      pasta: { type: "string", description: "Subpasta dentro da pasta de publicação (criada se não existir). Ex.: 2026/padaria-joao. Omitir = a própria pasta de publicação." },
      arquivo: { type: "string", description: "Nome do arquivo, só letras/números/ponto/hífen/sublinhado. Padrão index.html." },
      conteudo: { type: "string", description: "Conteúdo completo do arquivo (UTF-8)." },
      substituir: { type: "boolean", description: "true troca o arquivo existente. Só depois do sim do usuário." },
      criarLink: { type: "boolean", description: "Padrão true: cria o link rastreável /r/CÓDIGO." },
      titulo: { type: "string", description: "Nome do link e título da prévia no WhatsApp. Ex.: Orçamento — Padaria do João." },
      descricao: { type: "string", description: "Texto curto da prévia no WhatsApp." },
    },
    required: ["conteudo"],
  },
  mutating: true,
  run: async (input, ctx) => {
    if (!ctx.isAdmin) return fail("Só administrador publica na hospedagem.");
    const conteudo = typeof input.conteudo === "string" ? input.conteudo : "";
    if (!conteudo.trim()) return fail("conteudo vazio.");
    if (conteudo.length > MAX_CHARS) return fail("Arquivo grande demais (máximo ~2 MB de texto).");

    // Empresa-alvo: a própria ou um cliente da carteira — nunca outra.
    let targetId = ctx.companyId;
    let targetName = "sua empresa";
    if (input.clientCompanyId && input.clientCompanyId !== ctx.companyId) {
      const client = await prisma.company.findFirst({
        where: { id: input.clientCompanyId, parentCompanyId: ctx.companyId },
        select: { id: true, name: true },
      });
      if (!client) return fail("Cliente não encontrado na carteira.");
      targetId = client.id;
      targetName = client.name;
    }
    const cfg = await prisma.cpanelIntegration.findUnique({ where: { companyId: targetId }, select: { status: true } });
    if (!cfg) {
      return fail(targetId === ctx.companyId
        ? "cPanel não configurado. Conecte em Configurações → Integrações → cPanel · Hospedagem."
        : `cPanel de ${targetName} não configurado. Conecte no cadastro do cliente → Marketing → Integrações.`);
    }

    const arquivo = (input.arquivo ?? "").trim() || "index.html";
    const ext = arquivo.split(".").pop()?.toLowerCase() ?? "";
    const blob = new Blob([conteudo], { type: `${MIME[ext] ?? "text/plain"};charset=utf-8` });

    let out: Awaited<ReturnType<typeof uploadCpanelFiles>>;
    try {
      out = await uploadCpanelFiles(targetId, {
        subPath: input.pasta ?? "",
        overwrite: input.substituir === true,
        files: [{ name: arquivo, data: blob }],
      });
    } catch (e) {
      return fail(e instanceof CpanelError ? e.message : "Falha ao falar com o cPanel.");
    }
    const r = out.results[0];
    const destino = `${out.dir}/${r.file}`;
    if (!r.ok) {
      return fail(r.exists
        ? `Já existe ${destino} — não troquei. Pergunte ao usuário se pode substituir e repita com substituir=true, ou use outro nome.`
        : `O cPanel recusou ${r.file}: ${r.reason}`);
    }

    await recordAdminAction({
      adminUserId: ctx.userId, adminUserName: ctx.userName,
      action: "CPANEL_UPLOAD", targetCompanyId: targetId,
      metadata: { dir: out.dir, files: [r.file], overwrite: input.substituir === true, origem: "assistente" },
    });

    if (!r.url) {
      return ok(
        `Publicado em ${destino}. Não tenho a URL do site dessa pasta, então não gerei link — preencha "URL do site nessa pasta" na integração cPanel.`,
        { data: { destino } },
      );
    }

    if (input.criarLink === false) {
      return ok(`Publicado: ${r.url}`, { data: { destino, url: r.url }, link: r.url });
    }

    const titulo = (input.titulo ?? "").trim().slice(0, 200) || null;
    const link = await prisma.trackingLink.create({
      data: {
        code: await newLinkCode(),
        destination: r.url,
        destType: "url",
        label: titulo ?? r.file,
        ogTitle: titulo,
        ogDescription: (input.descricao ?? "").trim().slice(0, 500) || null,
        companyId: targetId,
      },
      select: { code: true },
    });
    const curto = appUrl(`/r/${link.code}`);
    return ok(
      `Publicado em ${r.url}\nLink pra mandar: ${curto} (conta os cliques; desative em Links quando a proposta encerrar).`,
      { data: { destino, url: r.url, linkCurto: curto, code: link.code }, link: curto },
    );
  },
};

export const siteTools: ToolDef[] = [publicarNoSite];

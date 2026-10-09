import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { clientComments } from "@/lib/checklist";
import { appBaseUrl, pieceFileIds } from "@/lib/approval";
import { fileVisibleToClient } from "@/lib/client-task-files";
import AprovarClient, { type ApprovalFile } from "./AprovarClient";

export const dynamic = "force-dynamic";

async function load(token: string) {
  const task = await prisma.projectTask.findUnique({
    where: { approvalToken: token },
    select: {
      id: true, projectId: true, title: true, description: true, status: true, comments: true, dueDate: true,
      approvalText: true, approvalRound: true, approvalCommentAt: true, approvalFileIds: true, approvalSentAt: true, approvedAt: true, approvedByName: true,
      project: {
        select: {
          name: true, publicToken: true, clientCompany: { select: { name: true } },
          // Agência dona do projeto: a tela veste a identidade dela.
          setor: { select: { company: { select: { name: true, tradeName: true, logoUrl: true, brandColor: true } } } },
        },
      },
    },
  });
  if (!task) return null;

  const comments = clientComments(task.comments);
  const version = comments.find((c) => c.at === task.approvalCommentAt && c.by !== "client") ?? null;

  // Peça: na 1ª rodada, todos os arquivos visíveis da tarefa (montado na hora,
  // então arquivo que a equipe sobe depois já aparece). Da 2ª em diante, a
  // lista guardada no envio — pra versão anterior não voltar misturada.
  const ids = await pieceFileIds(task);
  const objs = ids.length
    ? await prisma.storageObject.findMany({
        where:  { id: { in: ids }, projectTaskId: task.id, status: "READY" },
        select: { id: true, fileName: true, mimeType: true },
      })
    : [];
  const byId = new Map(objs.map((o) => [o.id, o]));
  const meta = new Map((version?.attachments ?? []).map((a) => [a.id, a]));
  const files: ApprovalFile[] = ids
    .filter((id) => byId.has(id) && fileVisibleToClient(task.comments, id))
    .map((id) => {
      const o = byId.get(id)!;
      return { id, fileName: o.fileName, mimeType: o.mimeType, status: meta.get(id)?.status ?? null, note: meta.get(id)?.note ?? null };
    });

  // Links da peça (pasta do Drive, Canva…): seção LINKS da tarefa + links
  // dos andamentos visíveis. Só http(s), sem repetir.
  const mats = await prisma.projectMaterial.findMany({
    where:   { taskId: task.id, kind: "LINK", visibleToClient: true, url: { not: null } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select:  { title: true, url: true },
  });
  const seen = new Set<string>();
  const links = [
    ...mats.map((m) => ({ url: m.url!, title: m.title })),
    ...comments.filter((c) => c.by !== "client").flatMap((c) => c.links ?? []).map((l) => ({ url: l.url, title: l.title ?? "" })),
  ].filter((l) => /^https?:\/\//i.test(l.url) && !seen.has(l.url) && !!seen.add(l.url));

  // Linha do tempo da peça, em ordem: cada envio de versão (com as artes que
  // foram), as mensagens da equipe (com anexos) e os retornos do cliente.
  // Cada item leva a versão em que aconteceu. Textos em destaque (📌) sobem
  // pro bloco "Para aprovar" e não repetem aqui; o eco "[Cliente]" já saiu em
  // clientComments. Nota que não deve aparecer → 🔒 na tarefa.
  const sends = await prisma.projectTaskEvent.findMany({
    where:   { taskId: task.id, type: "APPROVAL_SENT" },
    orderBy: { createdAt: "asc" },
    select:  { createdAt: true, toText: true, fromText: true },
  });
  const roundOf = (s: { toText: string | null }, fallback: number) =>
    Number(/Rodada (\d+)/.exec(s.toText ?? "")?.[1]) || fallback;
  const roundAt = (iso: string) => {
    const t = new Date(iso).getTime();
    let r = 0;
    for (const s of sends) {
      if (s.createdAt.getTime() > t) break;
      r = roundOf(s, r + 1);
    }
    return r || null;
  };

  // Só miniatura de arquivo que existe e o cliente pode ver.
  const ready = await prisma.storageObject.findMany({
    where:  { projectTaskId: task.id, status: "READY" },
    select: { id: true, fileName: true, mimeType: true },
  });
  const readyById = new Map(ready.map((o) => [o.id, o]));
  const thumbs = (ids: string[]) =>
    ids
      .filter((id) => readyById.has(id) && fileVisibleToClient(task.comments, id))
      .map((id) => readyById.get(id)!)
      .sort((x, y) => x.fileName.localeCompare(y.fileName, "pt-BR", { numeric: true }));

  type Item = {
    kind: "sent" | "team" | "approve" | "adjust" | "note";
    text: string; who: string | null; at: string; round: number | null;
    files: { id: string; fileName: string; mimeType: string }[];
  };
  const items: Item[] = [];
  const roundsShown = new Set<number>();
  sends.forEach((s, i) => {
    const r = roundOf(s, i + 1);
    if (roundsShown.has(r)) return; // reenvio da mesma versão não repete
    roundsShown.add(r);
    items.push({
      kind: "sent", text: "", who: null, at: s.createdAt.toISOString(), round: r,
      files: thumbs((s.fromText ?? "").split(",").filter(Boolean)),
    });
  });
  // Arquivos que já aparecem num "Enviada pra aprovação": o andamento só de
  // anexo (sem texto) com eles não repete as mesmas miniaturas.
  const sentIds = new Set(items.flatMap((it) => it.files.map((f) => f.id)));
  for (const c of comments) {
    if (c.hl) continue;
    const client = c.by === "client";
    const all = client ? [] : thumbs((c.attachments ?? []).map((x) => x.id));
    // Mesmas artes de um envio: o texto fica, as miniaturas não repetem.
    const files = all.every((f) => sentIds.has(f.id)) ? [] : all;
    if (!c.text?.trim() && !files.length) continue;
    items.push({
      kind: !client ? "team"
        : c.text.startsWith("✓ Aprovado") ? "approve"
        : c.text.startsWith("✎ Ajuste pedido") ? "adjust"
        : "note",
      text: client ? c.text.replace(/^(✓ Aprovado|✎ Ajuste pedido) por [^\n]+\n?/, "").trim() : c.text,
      who:  client ? (/^(?:✓ Aprovado|✎ Ajuste pedido) por ([^\n]+)/.exec(c.text)?.[1] ?? null) : null,
      at:   c.at,
      round: roundAt(c.at),
      files,
    });
  }
  items.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
  const history = items.slice(-30);

  // Bloco "Para aprovar": textos que a equipe destacou (legenda, roteiro…).
  const highlights = comments
    .filter((c) => c.by !== "client" && c.hl && c.text?.trim())
    .map((c) => ({ text: c.text, at: c.at }));

  // Da 2ª rodada em diante: o que o cliente (ou a equipe por ele) marcou como
  // alteração/reprovada nas versões anteriores, com o pedido — pra ele conferir
  // se o ajuste atendeu antes de aprovar a versão nova.
  const current = new Set(files.map((f) => f.id));
  const seenPrev = new Set<string>();
  const previous: ApprovalFile[] = task.approvalRound > 1
    ? comments
        .filter((c) => c.by !== "client")
        .flatMap((c) => c.attachments ?? [])
        .filter((a) => (a.status === "alteracao" || a.status === "reprovada") && !current.has(a.id)
          && fileVisibleToClient(task.comments, a.id) && !seenPrev.has(a.id) && !!seenPrev.add(a.id))
        .map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, status: a.status ?? null, note: a.note ?? null }))
        .sort((x, y) => x.fileName.localeCompare(y.fileName, "pt-BR", { numeric: true }))
    : [];

  return { task, files, links, history, highlights, previous, versionText: version?.text ?? "" };
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await load(token);
  if (!data) return { title: "Aprovação", robots: { index: false, follow: false } };
  const firstImage = data.files.find((f) => f.mimeType.startsWith("image/"));
  const base = appBaseUrl();
  return {
    title: `Aprovação · ${data.task.title}`,
    description: data.task.project.clientCompany?.name
      ? `Peça de ${data.task.project.clientCompany.name} esperando sua aprovação.`
      : "Peça esperando sua aprovação.",
    robots: { index: false, follow: false },
    // Prévia da arte no próprio WhatsApp (o robô segue o redirect do arquivo).
    ...(firstImage && base
      ? { openGraph: { images: [`${base}/api/aprovar/${token}/arquivo/${firstImage.id}`] } }
      : {}),
  };
}

export default async function AprovarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await load(token);

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#06070C", color: "#727A8C", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif", fontSize: 14, padding: 16, textAlign: "center" }}>
        Link inválido ou expirado. Fale com a agência pelo grupo.
      </div>
    );
  }

  const { task, files, links, history, highlights, previous, versionText } = data;
  return (
    <AprovarClient
      token={token}
      title={task.title}
      // O que foi ENVIADO, não o descritivo de agora (pode ter sido editado depois).
      description={task.approvalText ?? task.description}
      // Prints colados no descritivo: liberados pelo próprio token de aprovação.
      mediaBase={`/api/projetos/${task.projectId}/materiais/__ID__/media?a=${encodeURIComponent(token)}`}
      clientName={task.project.clientCompany?.name ?? null}
      projectName={task.project.name}
      panelToken={task.project.publicToken}
      status={task.status}
      round={task.approvalRound}
      sentAt={task.approvalSentAt?.toISOString() ?? null}
      dueDate={task.dueDate?.toISOString() ?? null}
      approvedAt={task.approvedAt?.toISOString() ?? null}
      approvedByName={task.approvedByName}
      versionText={versionText}
      files={files}
      previous={previous}
      links={links}
      brand={{
        name:    task.project.setor.company.tradeName || task.project.setor.company.name,
        logoUrl: task.project.setor.company.logoUrl,
        color:   task.project.setor.company.brandColor,
      }}
      history={history}
      highlights={highlights}
    />
  );
}

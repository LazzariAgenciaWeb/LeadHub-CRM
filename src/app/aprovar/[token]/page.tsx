import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { clientComments } from "@/lib/checklist";
import { appBaseUrl, collectApprovalFiles, readFileIds } from "@/lib/approval";
import { fileVisibleToClient } from "@/lib/client-task-files";
import AprovarClient, { type ApprovalFile } from "./AprovarClient";

export const dynamic = "force-dynamic";

async function load(token: string) {
  const task = await prisma.projectTask.findUnique({
    where: { approvalToken: token },
    select: {
      id: true, title: true, description: true, status: true, comments: true, dueDate: true,
      approvalRound: true, approvalCommentAt: true, approvalFileIds: true, approvalSentAt: true, approvedAt: true, approvedByName: true,
      project: { select: { name: true, publicToken: true, clientCompany: { select: { name: true } } } },
    },
  });
  if (!task) return null;

  const comments = clientComments(task.comments);
  const version = comments.find((c) => c.at === task.approvalCommentAt && c.by !== "client") ?? null;

  // Peça = arquivos guardados no envio. Links enviados antes disso (sem a
  // lista) montam na hora: anexos da versão + arquivos soltos da tarefa.
  const saved = readFileIds(task.approvalFileIds);
  const ids = saved.length ? saved : (await collectApprovalFiles(task)).ids;
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

  // Conversa da peça: o que o cliente já pediu e o que a equipe respondeu
  // (sem os andamentos internos). Mais recente por último.
  const history = comments
    .filter((c) => c.text?.trim() && c !== version)
    .slice(-8)
    .map((c) => ({ text: c.text, at: c.at, byClient: c.by === "client" }));

  return { task, files, history, versionText: version?.text ?? "" };
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

  const { task, files, history, versionText } = data;
  return (
    <AprovarClient
      token={token}
      title={task.title}
      description={task.description}
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
      history={history}
    />
  );
}

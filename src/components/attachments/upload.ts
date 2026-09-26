// Upload direto pro MinIO: pede URL assinada à API, sobe o binário do browser
// pro bucket (sem passar pelo Next) e confirma. Ver /api/storage.

export type StoredFile = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  ticketMessageId?: string | null;
  uploadedById?: string | null;
  uploadedBy?: { name: string | null } | null;
};

export type UploadTarget = { ticketId: string } | { projectTaskId: string } | { libraryCompanyId: string };

export async function uploadFile(
  file: File,
  target: UploadTarget,
  opts: { draft?: boolean; onProgress?: (pct: number) => void } = {},
): Promise<StoredFile> {
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...target,
      fileName: file.name || "arquivo",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      draft: opts.draft,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falha ao preparar o upload");

  const form = new FormData();
  for (const [k, v] of Object.entries(data.fields as Record<string, string>)) form.append(k, v);
  form.append("file", file); // precisa ser o último campo

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", data.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage recusou o arquivo (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Não foi possível conectar ao storage"));
    xhr.send(form);
  });

  const done = await fetch(`/api/storage/${data.id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: opts.draft }),
  });
  const file_ = await done.json().catch(() => ({}));
  if (!done.ok) throw new Error(file_.error || "Falha ao confirmar o upload");
  return file_ as StoredFile;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileIcon(mime: string, name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎧";
  if (mime === "application/pdf" || ext === "pdf") return "📕";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "📊";
  if (["doc", "docx", "odt", "rtf", "txt"].includes(ext)) return "📄";
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return "📽️";
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "🗜️";
  return "📎";
}

// Reconhece o serviço de um link pra mostrar ícone/rótulo (biblioteca do cliente).

export type LinkKind = { key: string; label: string; icon: string };

const KINDS: { test: RegExp; kind: LinkKind }[] = [
  { test: /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/i, kind: { key: "drive",   label: "Google Drive", icon: "📁" } },
  { test: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i,               kind: { key: "youtube", label: "YouTube",      icon: "▶️" } },
  { test: /(^|\.)vimeo\.com$/i,                                  kind: { key: "vimeo",   label: "Vimeo",        icon: "▶️" } },
  { test: /(^|\.)canva\.com$/i,                                  kind: { key: "canva",   label: "Canva",        icon: "🎨" } },
  { test: /(^|\.)figma\.com$/i,                                  kind: { key: "figma",   label: "Figma",        icon: "🎨" } },
  { test: /(^|\.)dropbox\.com$/i,                                kind: { key: "dropbox", label: "Dropbox",      icon: "📦" } },
  { test: /(^|\.)wetransfer\.com$|(^|\.)we\.tl$/i,               kind: { key: "wetransfer", label: "WeTransfer", icon: "📦" } },
];

export function linkKind(url: string | null | undefined): LinkKind {
  try {
    const host = new URL(url ?? "").hostname;
    return KINDS.find((k) => k.test.test(host))?.kind ?? { key: "web", label: host.replace(/^www\./, ""), icon: "🔗" };
  } catch {
    return { key: "web", label: "Link", icon: "🔗" };
  }
}

export function isImageMime(mime: string | null | undefined): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif)$/i.test(mime ?? "");
}

export function fileEmoji(mime: string | null | undefined, name = ""): string {
  const m = mime ?? "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("image/")) return "🖼";
  if (m.startsWith("video/")) return "🎬";
  if (m.startsWith("audio/")) return "🎵";
  if (m === "application/pdf" || ext === "pdf") return "📕";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜";
  if (["ai", "psd", "cdr", "eps", "indd"].includes(ext)) return "🎨";
  if (["doc", "docx", "odt"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "📊";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "📽";
  return "📄";
}

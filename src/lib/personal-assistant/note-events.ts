import { prisma } from "@/lib/prisma";

export type NoteEventType = "CREATED" | "EDITED" | "APPENDED" | "DONE" | "REOPENED" | "DELEGATED";

/** Registra um evento no histórico do item do bloquinho (nunca lança). */
export async function logNoteEvent(noteId: string, type: NoteEventType, source: string, detail?: string | null) {
  try {
    await prisma.assistantNoteEvent.create({ data: { noteId, type, source, detail: detail?.trim() || null } });
  } catch (e) {
    console.error("[assistente] note event:", e);
  }
}

/** Descreve os campos alterados numa edição ("alterou título, data"). */
export function describeEdit(data: Record<string, unknown>): string {
  if (data.inMatrix === false) return "tirou da matriz (só anotado)";
  const names: Record<string, string> = { title: "título", body: "texto", kind: "tipo", dueAt: "data", tags: "etiquetas", important: "quadrante da matriz", urgent: "quadrante da matriz", inMatrix: "quadrante da matriz" };
  const changed = [...new Set(Object.keys(data).filter((k) => names[k]).map((k) => names[k]))];
  return changed.length ? `alterou ${changed.join(", ")}` : "editou";
}

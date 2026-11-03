/**
 * Segmento do projeto (`SetorClickupList.type`). É texto livre no banco: os
 * quatro padrões têm código fixo (SITE, MIDIA…) e cor própria na lista; os
 * criados pela equipe ("Branding", "Consultoria") são gravados como digitados.
 */
export const DEFAULT_SEGMENTS = [
  { value: "SITE",     label: "Site" },
  { value: "MIDIA",    label: "Mídia" },
  { value: "CAMPANHA", label: "Campanha" },
  { value: "OUTRO",    label: "Outro" },
] as const;

export const SEGMENT_MAX = 40;

const BY_CODE = new Map<string, string>(DEFAULT_SEGMENTS.map((s) => [s.value, s.label]));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

export function segmentLabel(t: string | null | undefined): string {
  if (!t) return "Sem segmento";
  return BY_CODE.get(t) ?? t;
}

/**
 * Normaliza o que veio da tela/assistente: "mídia" vira MIDIA (um padrão),
 * o resto fica como digitado (aparado, até SEGMENT_MAX). Vazio = sem segmento.
 */
export function normalizeSegment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, " ").slice(0, SEGMENT_MAX);
  if (!v) return null;
  const n = norm(v);
  const padrao = DEFAULT_SEGMENTS.find((s) => s.value === n || norm(s.label) === n);
  return padrao ? padrao.value : v;
}

import { getSourceMeta, SOURCE_COLOR_CLASSES } from "@/lib/sources";

interface SourceBadgeProps {
  source: string | null | undefined;
  size?: "xs" | "sm" | "md";
  showIcon?: boolean;
}

export default function SourceBadge({ source, size = "sm", showIcon = true }: SourceBadgeProps) {
  const meta = getSourceMeta(source);
  const colorClass = SOURCE_COLOR_CLASSES[meta.color];

  const sizeClass =
    size === "xs" ? "px-1.5 py-0.5 text-[9px] gap-0.5" :
    size === "sm" ? "px-2 py-0.5 text-[10px] gap-1" :
                    "px-2.5 py-1 text-xs gap-1.5";

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${sizeClass} ${colorClass}`}>
      {showIcon && <span>{meta.icon}</span>}
      <span>{meta.label}</span>
    </span>
  );
}

import { Inter_Tight } from "next/font/google";

// Logo "gohub." — "go" fúcsia e grosso, "hub" mais fino, ponto fúcsia.
// Mesma identidade do site gohub.com.br. `tone` é a cor do fundo onde fica.

const tight = Inter_Tight({ subsets: ["latin"], weight: ["400", "800"], display: "swap" });

export const GOHUB_PINK = "#FF2E96";

export default function GohubLogo({ tone = "dark", size = 30 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span
      className={tight.className}
      style={{ fontSize: size, lineHeight: 1, letterSpacing: "-0.045em", color: tone === "dark" ? "#FFFFFF" : "#0B0B0D", whiteSpace: "nowrap" }}
      aria-label="gohub"
    >
      <b style={{ color: GOHUB_PINK, fontWeight: 800 }}>go</b>
      <span style={{ fontWeight: 400 }}>hub</span>
      <b style={{ color: GOHUB_PINK, fontWeight: 800 }}>.</b>
    </span>
  );
}

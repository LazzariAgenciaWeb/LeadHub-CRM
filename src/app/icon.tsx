import { ImageResponse } from "next/og";

// Ícone da aba e do atalho: "go" fúcsia sobre preto (identidade gohub.).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0B0D", borderRadius: 14, color: "#FF2E96", fontSize: 38, fontWeight: 800, letterSpacing: -2 }}>
        go
      </div>
    ),
    size,
  );
}

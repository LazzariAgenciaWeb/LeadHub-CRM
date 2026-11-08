import { ImageResponse } from "next/og";

// Atalho na tela inicial do iPhone: mesmo "go" fúcsia sobre preto.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0B0D", color: "#FF2E96", fontSize: 104, fontWeight: 800, letterSpacing: -6 }}>
        go
      </div>
    ),
    size,
  );
}

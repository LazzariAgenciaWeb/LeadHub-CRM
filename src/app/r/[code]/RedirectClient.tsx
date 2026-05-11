"use client";

import { useEffect } from "react";

export default function RedirectClient({
  linkId,
  code,
  dest,
}: {
  linkId: string;
  code: string;
  dest: string;
}) {
  useEffect(() => {
    // Incrementa o contador de cliques (não bloqueia o redirect)
    fetch(`/api/tracking-links/${linkId}/click`, { method: "POST" }).catch(
      () => {}
    );
    // Anexa ?lh_ref=CODE ao destino pra que o snippet de tracking interno
    // (data-lh-track) na página da proposta saiba qual TrackingLink reportar.
    // Preserva query/hash existentes.
    let target = dest;
    try {
      const u = new URL(dest);
      u.searchParams.set("lh_ref", code);
      target = u.toString();
    } catch {
      // Destino malformado — usa como está.
    }
    window.location.replace(target);
  }, [linkId, code, dest]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#080b12",
        color: "#94a3b8",
        fontFamily: "sans-serif",
        gap: "12px",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: "3px solid #4f46e5",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }}
      />
      <span style={{ fontSize: 14 }}>Redirecionando...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

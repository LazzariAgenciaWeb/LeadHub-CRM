"use client";

import { useEffect } from "react";

export default function RedirectClient({
  linkId,
  dest,
}: {
  linkId: string;
  dest: string;
}) {
  useEffect(() => {
    // Incrementa o contador de cliques (não bloqueia o redirect)
    fetch(`/api/tracking-links/${linkId}/click`, { method: "POST" }).catch(
      () => {}
    );
    // Redireciona imediatamente
    window.location.replace(dest);
  }, [linkId, dest]);

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

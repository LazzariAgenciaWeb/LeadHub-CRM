"use client";

import { useEffect } from "react";

export default function RedirectClient({
  linkId,
  code,
  dest,
  isActive,
}: {
  linkId: string;
  code: string;
  dest: string;
  isActive: boolean;
}) {
  useEffect(() => {
    // Sempre registra o clique — inclusive quando o link está pausado, pra
    // que o atendente saiba que o cliente tentou abrir uma proposta encerrada.
    fetch(`/api/tracking-links/${linkId}/click`, { method: "POST" }).catch(
      () => {}
    );

    if (!isActive) return;

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
  }, [linkId, code, dest, isActive]);

  if (!isActive) {
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
          gap: "16px",
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 56 }}>⏸</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0", margin: 0 }}>
          Esta proposta foi encerrada
        </h1>
        <p style={{ fontSize: 14, maxWidth: 420, lineHeight: 1.5, margin: 0 }}>
          O conteúdo deste link não está mais disponível. Entre em contato com
          a pessoa que enviou o link para receber uma nova versão.
        </p>
      </div>
    );
  }

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

"use client";

import { useEffect } from "react";

/**
 * Dispara o batch diário de gamificação no primeiro acesso do dia ao painel.
 *
 * Dedup em duas camadas:
 *   1. Cliente: sessionStorage por (dia, browser tab) — evita refazer fetch
 *      a cada navegação SPA dentro da mesma sessão.
 *   2. Servidor: lock atômico em Setting — apenas 1 execução real por
 *      empresa por dia, mesmo se múltiplos usuários abrirem ao mesmo tempo.
 *
 * Fire-and-forget: não bloqueia o render, ignora erros.
 */
export default function DailyCronAutoTick() {
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `gamificacao:auto-tick:${today}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    fetch("/api/cron/gamificacao/auto-tick", { method: "POST" })
      .catch(() => {/* silencioso — cron externo (se houver) cobre */});
  }, []);

  return null;
}

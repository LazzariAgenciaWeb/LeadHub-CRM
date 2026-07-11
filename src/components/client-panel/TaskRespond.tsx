"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Caixa de resposta do cliente numa tarefa marcada como "aguardando você".
export default function TaskRespond({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!text.trim()) return;
    setSending(true); setErr("");
    const res = await fetch(`/api/meu-espaco/tarefas/${taskId}/responder`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text: text.trim() }),
    });
    setSending(false);
    if (res.ok) { setText(""); router.refresh(); }
    else { const d = await res.json().catch(() => ({})); setErr(d.error ?? "Não foi possível enviar."); }
  }

  return (
    <div className="tkresp">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Escreva sua resposta ou o retorno pra equipe…"
      />
      {err && <p className="tkresperr">{err}</p>}
      <button onClick={send} disabled={sending || !text.trim()}>{sending ? "Enviando…" : "Responder"}</button>
    </div>
  );
}

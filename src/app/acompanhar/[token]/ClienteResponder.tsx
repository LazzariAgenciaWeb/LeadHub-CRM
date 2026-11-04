"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile, formatBytes, fileIcon, type StoredFile } from "@/components/attachments/upload";

// Caixa de retorno do cliente na página pública do chamado. Sem login: o nome
// é digitado (e lembrado no próprio navegador) e o token do link autoriza.
// Chamado resolvido/fechado reabre quando ele escreve — o botão já avisa isso.

const NOME_KEY = "acompanhar:nome";

const erro = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const card: React.CSSProperties = {
  background: "#0C1220", border: "1px solid #1E2D45", borderRadius: 14, padding: 16,
};
const field: React.CSSProperties = {
  width: "100%", background: "#070B14", border: "1px solid #1E2D45", borderRadius: 10,
  color: "#E2E8F0", fontSize: 14, padding: "10px 12px", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box",
};
const label: React.CSSProperties = {
  display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: 1,
  color: "#64748B", margin: "0 0 6px",
};

export default function ClienteResponder({
  token, status, storageOn,
}: {
  token: string; status: string; storageOn: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  // Quem já escreveu uma vez não digita o nome de novo. Só depois de montar:
  // no HTML do servidor não existe localStorage.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setName(localStorage.getItem(NOME_KEY) ?? ""); } catch { /* sem storage */ }
  }, []);

  const encerrado = status === "RESOLVED" || status === "CLOSED";

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!chosen.length) return;
    setErr("");
    for (const f of chosen) {
      setUploading((n) => n + 1);
      try {
        const stored = await uploadFile(f, null, { draft: true, ticketToken: token });
        setFiles((list) => [...list, stored]);
      } catch (e) {
        setErr(erro(e, "Não foi possível anexar o arquivo."));
      }
      setUploading((n) => n - 1);
    }
  }

  async function send() {
    if (name.trim().length < 2) { setErr("Escreva seu nome."); return; }
    if (!text.trim() && !files.length) { setErr("Escreva sua mensagem ou anexe um arquivo."); return; }
    setSending(true); setErr("");
    try {
      const res = await fetch(`/api/acompanhar/${encodeURIComponent(token)}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim(), text: text.trim(), attachmentIds: files.map((f) => f.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar.");
      try { localStorage.setItem(NOME_KEY, name.trim()); } catch { /* sem localStorage */ }
      setText(""); setFiles([]); setOk(true);
      router.refresh();
    } catch (e) {
      setErr(erro(e, "Não foi possível enviar."));
    }
    setSending(false);
  }

  const busy = sending || uploading > 0;

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Falar com a equipe</p>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94A3B8" }}>
        {encerrado
          ? "Este chamado está encerrado — se escrever aqui, ele volta pra fila da equipe."
          : "Mande uma informação nova, um print ou tire uma dúvida. Entra direto no atendimento."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={label} htmlFor="resp-nome">Seu nome</label>
          <input id="resp-nome" style={field} value={name} maxLength={80}
            onChange={(e) => { setName(e.target.value); setOk(false); }}
            placeholder="Como a equipe te chama" />
        </div>

        <div>
          <label style={label} htmlFor="resp-msg">Sua mensagem</label>
          <textarea id="resp-msg" rows={4} style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
            value={text} maxLength={4000}
            onChange={(e) => { setText(e.target.value); setOk(false); }}
            placeholder="Escreva aqui…" />
        </div>

        {storageOn && (
          <div>
            <input ref={fileRef} type="file" multiple onChange={pick} style={{ display: "none" }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              style={{
                background: "#0F1829", border: "1px solid #1E2D45", borderRadius: 9, color: "#93C5FD",
                fontSize: 13, padding: "8px 12px", cursor: busy ? "default" : "pointer", fontFamily: "inherit",
              }}>
              📎 Anexar arquivo
            </button>
            {uploading > 0 && (
              <span style={{ fontSize: 12, color: "#94A3B8", marginLeft: 10 }}>
                Enviando {uploading} arquivo{uploading > 1 ? "s" : ""}…
              </span>
            )}
            {files.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {files.map((f) => (
                  <div key={f.id} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#CBD5E1",
                    background: "#070B14", border: "1px solid #1E2D45", borderRadius: 9, padding: "7px 10px",
                  }}>
                    <span>{fileIcon(f.mimeType, f.fileName)}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>
                    <span style={{ fontSize: 11, color: "#64748B" }}>{formatBytes(f.size)}</span>
                    <button type="button" aria-label={`Tirar ${f.fileName}`}
                      onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                      style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14, padding: 0 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {err && <p style={{ margin: 0, fontSize: 13, color: "#FCA5A5" }}>{err}</p>}
        {ok && !err && (
          <p style={{ margin: 0, fontSize: 13, color: "#34D399" }}>
            Recebido! A equipe foi avisada e sua mensagem já está no andamento.
          </p>
        )}

        <div>
          <button type="button" onClick={send} disabled={busy}
            style={{
              background: busy ? "#1E2D45" : "linear-gradient(135deg,#6E86FF,#9B7BFF)",
              border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600,
              padding: "11px 20px", cursor: busy ? "default" : "pointer", fontFamily: "inherit",
            }}>
            {sending ? "Enviando…" : encerrado ? "Reabrir e enviar" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

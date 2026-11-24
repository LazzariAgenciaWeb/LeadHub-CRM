"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile, formatBytes, fileIcon, type StoredFile } from "@/components/attachments/upload";

// Caixa de retorno do cliente na página pública do chamado. Sem login: o nome
// é digitado (e lembrado no próprio navegador) e o token do link autoriza.
// Chamado resolvido/fechado reabre quando ele escreve — o botão já avisa isso.

const NOME_KEY = "acompanhar:nome";

const erro = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// Classes da casca compartilhada com a aprovação (ClientePublicShell): card,
// input.f, btn ok/ghost, err, hint. Aqui só o que é desta caixa.
const CSS = `
.resp{margin-top:16px}
.resp .lb{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);margin:0 0 6px}
.resp .col{display:flex;flex-direction:column;gap:12px}
.resp .fls{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.resp .fi{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);background:#0B0D15;border:1px solid var(--line2);border-radius:10px;padding:7px 10px}
.resp .fi span.n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.resp .fi button{background:none;border:0;color:var(--ink3);cursor:pointer;font-size:14px;padding:0}
.resp .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.resp .btn.ghost{flex:none;padding:10px 14px;font-size:13px}
.resp .btn.ok{flex:none;min-width:160px}
.resp .okmsg{margin:0;font-size:13px;color:var(--ok)}
@media (max-width:560px){.resp .btn.ok{flex:1}}
`;

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
    <div className="card resp">
      <style>{CSS}</style>
      <h3>Falar com a equipe</h3>
      <p className="hint" style={{ margin: "0 0 14px" }}>
        {encerrado
          ? "Este chamado está encerrado — se escrever aqui, ele volta pra fila da equipe."
          : "Mande uma informação nova, um print ou tire uma dúvida. Entra direto no atendimento."}
      </p>

      <div className="col">
        <div>
          <label className="lb" htmlFor="resp-nome">Seu nome</label>
          <input id="resp-nome" className="f" value={name} maxLength={80} autoComplete="name"
            onChange={(e) => { setName(e.target.value); setOk(false); }}
            placeholder="Como a equipe te chama" />
        </div>

        <div>
          <label className="lb" htmlFor="resp-msg">Sua mensagem</label>
          <textarea id="resp-msg" rows={4} className="f"
            value={text} maxLength={4000}
            onChange={(e) => { setText(e.target.value); setOk(false); }}
            placeholder="Escreva aqui…" />
        </div>

        {storageOn && (
          <div>
            <input ref={fileRef} type="file" multiple onChange={pick} style={{ display: "none" }} />
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                📎 Anexar arquivo
              </button>
              {uploading > 0 && (
                <span className="hint">Enviando {uploading} arquivo{uploading > 1 ? "s" : ""}…</span>
              )}
            </div>
            {files.length > 0 && (
              <div className="fls">
                {files.map((f) => (
                  <div key={f.id} className="fi">
                    <span>{fileIcon(f.mimeType, f.fileName)}</span>
                    <span className="n">{f.fileName}</span>
                    <span className="hint">{formatBytes(f.size)}</span>
                    <button type="button" aria-label={`Tirar ${f.fileName}`}
                      onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        {ok && !err && (
          <p className="okmsg">Recebido! A equipe foi avisada e sua mensagem já está no andamento.</p>
        )}

        <div className="row">
          <button type="button" className="btn ok" onClick={send} disabled={busy}>
            {sending ? "Enviando…" : encerrado ? "Reabrir e enviar" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

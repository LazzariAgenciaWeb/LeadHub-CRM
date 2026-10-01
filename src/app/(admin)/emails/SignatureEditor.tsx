"use client";

/**
 * Editor da assinatura de email: texto formatado, link e imagem.
 *
 * A área de edição é o próprio resultado (fundo branco, como o email vai
 * chegar), e o botão "HTML" abre o código pra quem quiser colar uma
 * assinatura pronta da agência.
 *
 * Imagem entra por URL de propósito: cliente de email não exibe imagem
 * embutida em assinatura — ela precisa estar publicada na internet.
 */
import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, Image as ImageIcon, Code2, Eraser } from "lucide-react";

interface Props {
  value: string;
  onChange: (html: string) => void;
}

export default function SignatureEditor({ value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);

  // Só escreve de fora quando o editor não está com o foco — senão o cursor
  // pula pro começo a cada tecla digitada.
  useEffect(() => {
    const el = ref.current;
    if (!el || htmlMode) return;
    if (document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value || "";
  }, [value, htmlMode]);

  function run(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  }

  function addLink() {
    const url = window.prompt("Endereço do link (https://...)");
    if (!url?.trim()) return;
    const sel = window.getSelection()?.toString();
    if (sel) run("createLink", url.trim());
    else run("insertHTML", `<a href="${url.trim()}">${url.trim()}</a>`);
  }

  function addImage() {
    const url = window.prompt(
      "URL da imagem (precisa estar publicada na internet — ex: https://azzagencia.com.br/logo.png)"
    );
    if (!url?.trim()) return;
    run("insertHTML", `<img src="${url.trim()}" alt="" style="max-width:220px;height:auto" />`);
  }

  const botao = "p-1.5 rounded-md text-slate-300 hover:bg-white/10";

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 bg-white/5 border-b border-white/10">
        <button type="button" onClick={() => run("bold")} title="Negrito" className={botao}><Bold size={13} /></button>
        <button type="button" onClick={() => run("italic")} title="Itálico" className={botao}><Italic size={13} /></button>
        <button type="button" onClick={addLink} title="Inserir link" className={botao}><Link2 size={13} /></button>
        <button type="button" onClick={addImage} title="Inserir imagem por URL" className={botao}><ImageIcon size={13} /></button>
        <button type="button" onClick={() => run("removeFormat")} title="Limpar formatação" className={botao}><Eraser size={13} /></button>
        <button type="button" onClick={() => setHtmlMode((v) => !v)} title="Editar o HTML"
          className={`${botao} ml-auto ${htmlMode ? "bg-indigo-500/20 text-indigo-200" : ""}`}>
          <Code2 size={13} />
        </button>
      </div>

      {htmlMode ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder='<p><b>Diego R. Lazzari</b><br/>AZZ Agência<br/><a href="https://azzagencia.com.br">azzagencia.com.br</a></p>'
          className="w-full bg-[#0a0f18] px-3 py-2 text-[11px] font-mono text-slate-300 focus:outline-none resize-y"
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={() => onChange(ref.current?.innerHTML ?? "")}
          onBlur={() => onChange(ref.current?.innerHTML ?? "")}
          data-placeholder="Sua assinatura: nome, cargo, telefone, site…"
          className="min-h-[90px] max-h-[220px] overflow-y-auto bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-800 focus:outline-none [&_img]:max-w-[220px] [&_a]:text-indigo-700 [&_a]:underline empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
        />
      )}

      <p className="px-2 py-1 text-[10px] text-slate-500 bg-white/5 border-t border-white/10">
        A imagem precisa estar publicada na internet (seu site, por exemplo) — clientes de email não
        exibem imagem guardada só aqui dentro.
      </p>
    </div>
  );
}

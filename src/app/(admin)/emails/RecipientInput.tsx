"use client";

/**
 * Campo de destinatário com sugestão (Para, Cc, Cco).
 *
 * As sugestões vêm de /api/email/inbox/contacts: quem você já enviou,
 * clientes cadastrados, leads e quem te escreveu. Como o campo aceita vários
 * endereços separados por vírgula, a busca usa só o trecho DEPOIS da última
 * vírgula — o que já foi digitado antes fica intacto.
 */
import { useEffect, useRef, useState } from "react";
import { AtSign, Building2, Target, Send } from "lucide-react";

interface Contato {
  email: string;
  name: string | null;
  source: "enviado" | "cliente" | "lead" | "recebido";
}

const ORIGEM = {
  enviado:  { Icon: Send,      label: "já enviado",  cls: "text-indigo-300" },
  cliente:  { Icon: Building2, label: "cliente",     cls: "text-emerald-300" },
  lead:     { Icon: Target,    label: "lead",        cls: "text-amber-300" },
  recebido: { Icon: AtSign,    label: "te escreveu", cls: "text-slate-400" },
} as const;

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function RecipientInput({ value, onChange, placeholder, autoFocus }: Props) {
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Contato[]>([]);
  const [ativo, setAtivo] = useState(0);
  const fecharTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const partes = value.split(/[,;]/);
  const token = (partes[partes.length - 1] ?? "").trim();

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => {
      fetch(`/api/email/inbox/contacts?q=${encodeURIComponent(token)}`)
        .then((r) => r.json())
        .then((j) => { setItens(j.contacts ?? []); setAtivo(0); })
        .catch(() => setItens([]));
    }, 180);
    return () => clearTimeout(t);
  }, [token, aberto]);

  function escolher(c: Contato) {
    const novas = [...partes];
    novas[novas.length - 1] = ` ${c.email}`;
    onChange(novas.join(",").replace(/^\s+/, "") + ", ");
    setItens([]);
    setAberto(false);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!aberto || !itens.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => (i + 1) % itens.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => (i - 1 + itens.length) % itens.length); }
    else if (e.key === "Enter" || e.key === "Tab") {
      // Enter com sugestão destacada completa o endereço em vez de enviar.
      if (itens[ativo]) { e.preventDefault(); escolher(itens[ativo]); }
    } else if (e.key === "Escape") {
      setAberto(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onKeyDown={aoTeclar}
        onBlur={() => { fecharTimer.current = setTimeout(() => setAberto(false), 150); }}
        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
      />

      {aberto && itens.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-[#141c2b] shadow-xl">
          {itens.map((c, i) => {
            const o = ORIGEM[c.source] ?? ORIGEM.recebido;
            return (
              <li key={c.email}>
                <button
                  type="button"
                  // mousedown antes do blur fechar a lista
                  onMouseDown={(e) => { e.preventDefault(); if (fecharTimer.current) clearTimeout(fecharTimer.current); escolher(c); }}
                  onMouseEnter={() => setAtivo(i)}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 ${i === ativo ? "bg-indigo-500/20" : "hover:bg-white/5"}`}
                >
                  <o.Icon size={12} className={`flex-shrink-0 ${o.cls}`} />
                  <span className="min-w-0 flex-1">
                    {c.name && <span className="block text-[12px] text-slate-200 truncate">{c.name}</span>}
                    <span className="block text-[11px] text-slate-400 truncate">{c.email}</span>
                  </span>
                  <span className="text-[9px] text-slate-500 flex-shrink-0">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Copy, Check, ExternalLink, Link2 } from "lucide-react";
import {
  WA_TOOL_MAX_MESSAGE,
  buildWaLink,
  isValidWaPhone,
  normalizeWaPhone,
} from "@/lib/whatsapp-link-tool";

interface Props {
  slug: string;
  ownerName: string;
  ownerLogoUrl: string | null;
  ownerWebsite: string | null;
}

export default function LinkWhatsappTool({ slug, ownerName, ownerLogoUrl, ownerWebsite }: Props) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("Olá! Vim pelo Instagram e quero saber mais.");
  const [copied, setCopied] = useState(false);
  const [touched, setTouched] = useState(false);

  const digits = useMemo(() => normalizeWaPhone(phone), [phone]);
  const phoneOk = isValidWaPhone(digits);
  // Mensagem obrigatória: é ela que diz de onde a pessoa veio ("Vim pelo
  // Instagram..."), senão o dono do link não sabe qual canal gerou o contato.
  const messageOk = message.trim().length > 0;
  const link = phoneOk && messageOk ? buildWaLink(digits, message) : "";

  // Registra o lead uma vez por combinação número+mensagem. Best-effort: se a
  // API falhar o visitante nem percebe — o link já está copiado.
  const [sentKey, setSentKey] = useState<string | null>(null);
  async function captureLead() {
    const key = `${digits}|${message.trim()}`;
    if (sentKey === key) return;
    setSentKey(key);
    try {
      await fetch("/api/ferramentas/link-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, phone: digits, message }),
        keepalive: true,
      });
    } catch {
      /* silencioso */
    }
  }

  async function handleCopy() {
    setTouched(true);
    if (!phoneOk || !messageOk) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Navegador sem clipboard API: seleciona o campo pra copiar à mão.
      const el = document.getElementById("wa-link-output") as HTMLInputElement | null;
      el?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    void captureLead();
  }

  function handleOpen() {
    setTouched(true);
    if (!phoneOk || !messageOk) return;
    void captureLead();
    window.open(link, "_blank", "noopener,noreferrer");
  }

  const showPhoneError = touched && !phoneOk;
  const showMessageError = touched && !messageOk;

  return (
    <div className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <header className="border-b border-[#1e2d45]">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          {ownerLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ownerLogoUrl} alt={ownerName} className="w-9 h-9 rounded-lg object-cover bg-white/5" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{ownerName}</p>
            <p className="text-slate-500 text-xs">Ferramenta gratuita</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 py-10">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1 text-emerald-300 text-xs font-medium mb-4">
              <Link2 className="w-3.5 h-3.5" />
              Link direto pro seu WhatsApp
            </div>
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-3">
              Gerador de link do WhatsApp
            </h1>
            <p className="text-slate-400 text-base">
              Cole na bio do Instagram, no site ou nos anúncios. Quem clicar já abre a conversa
              com a sua mensagem pronta.
            </p>
          </div>

          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5 md:p-6 space-y-5">
            <div>
              <label htmlFor="wa-phone" className="block text-slate-300 text-sm font-medium mb-1.5">
                Seu número do WhatsApp
              </label>
              <input
                id="wa-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(51) 99999-0001"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setTouched(true)}
                className={`w-full bg-[#080b12] border rounded-xl px-4 py-3 text-white placeholder:text-slate-600 outline-none focus:border-emerald-500 transition-colors ${
                  showPhoneError ? "border-red-500/60" : "border-[#1e2d45]"
                }`}
              />
              <p className={`text-xs mt-1.5 ${showPhoneError ? "text-red-400" : "text-slate-500"}`}>
                {showPhoneError
                  ? "Digite o número com DDD. Ex.: (51) 99999-0001"
                  : "Com DDD. Número de outro país? Inclua o código do país na frente."}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="wa-message" className="text-slate-300 text-sm font-medium">
                  Mensagem que o cliente vai mandar <span className="text-red-400">*</span>
                </label>
                <span className="text-slate-600 text-xs">
                  {message.length}/{WA_TOOL_MAX_MESSAGE}
                </span>
              </div>
              <textarea
                id="wa-message"
                rows={3}
                maxLength={WA_TOOL_MAX_MESSAGE}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onBlur={() => setTouched(true)}
                className={`w-full bg-[#080b12] border rounded-xl px-4 py-3 text-white placeholder:text-slate-600 outline-none focus:border-emerald-500 transition-colors resize-y ${
                  showMessageError ? "border-red-500/60" : "border-[#1e2d45]"
                }`}
                placeholder="Olá! Vim pelo Instagram e quero saber mais."
              />
              <p className={`text-xs mt-1.5 ${showMessageError ? "text-red-400" : "text-slate-500"}`}>
                {showMessageError
                  ? "Escreva a mensagem. É ela que mostra de onde a pessoa veio."
                  : "Ela chega já digitada e identifica o canal: um link com \"Vim pelo Instagram\" na bio, outro com \"Vi o anúncio\" nos anúncios. Assim você sabe de onde veio cada contato."}
              </p>
            </div>

            <div>
              <label htmlFor="wa-link-output" className="block text-slate-300 text-sm font-medium mb-1.5">
                Seu link
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="wa-link-output"
                  readOnly
                  value={link}
                  placeholder="Preencha o número e a mensagem pra gerar o link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 bg-[#080b12] border border-[#1e2d45] rounded-xl px-4 py-3 text-emerald-300 text-sm font-mono placeholder:text-slate-600 placeholder:font-sans outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copiado!" : "Copiar link"}
                </button>
              </div>
              <button
                type="button"
                onClick={handleOpen}
                className="mt-3 inline-flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Testar o link no WhatsApp
              </button>
              <p className="text-slate-500 text-xs leading-relaxed mt-4 pt-4 border-t border-[#1e2d45]">
                Ao copiar ou testar o link, você concorda que{" "}
                <span className="text-slate-400">{ownerName}</span> guarde o número e a mensagem
                informados e entre em contato por WhatsApp para apresentar seus serviços.
                Seus dados não são compartilhados com mais ninguém.
              </p>
            </div>
          </div>

          <div className="mt-8 grid sm:grid-cols-3 gap-3 text-sm">
            {[
              ["Bio do Instagram", "Troque o 'link na bio' por este e receba a mensagem direto."],
              ["Anúncios", "Use como destino do botão do anúncio no Meta ou Google."],
              ["Site e e-mail", "Coloque no botão 'Fale conosco' e na assinatura."],
            ].map(([title, desc]) => (
              <div key={title} className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4">
                <p className="text-white font-semibold mb-1">{title}</p>
                <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#1e2d45] py-6 px-5 text-xs text-slate-600">
        <div className="max-w-2xl mx-auto space-y-3">
          <div>
            <p className="text-slate-400 font-semibold mb-1">Termo de coleta e uso de dados</p>
            <p className="leading-relaxed">
              Esta ferramenta é gratuita. Ao gerar e copiar o seu link, o número de WhatsApp e a
              mensagem que você informou ficam guardados por{" "}
              <span className="text-slate-400">{ownerName}</span>. Esses dados são usados
              exclusivamente para entrarmos em contato com você por WhatsApp, apresentando nossos
              serviços e ofertas. Não vendemos, cedemos nem compartilhamos seus dados com terceiros.
              A qualquer momento você pode pedir a exclusão respondendo à nossa mensagem.
            </p>
          </div>
          <p className="text-center">
            Ferramenta oferecida por{" "}
            {ownerWebsite ? (
              <a
                href={ownerWebsite}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white"
              >
                {ownerName}
              </a>
            ) : (
              <span className="text-slate-400">{ownerName}</span>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}

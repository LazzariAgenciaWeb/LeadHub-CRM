"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Play, Check } from "lucide-react";

/** Extrai o ID do YouTube (watch?v=, youtu.be/, embed/, shorts/). */
function ytId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default function OnboardingVideoCard({ initialUrl }: { initialUrl: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = ytId(url.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ key: "onboarding_video_url", value: url.trim() }]),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <section className="bg-gradient-to-br from-[#1a1330] to-[#0f1623] border border-purple-500/30 rounded-xl p-5 mb-6">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Preview / thumbnail */}
        {id ? (
          <a
            href={url.trim()}
            target="_blank"
            rel="noopener noreferrer"
            title="Assistir no YouTube"
            className="relative flex-shrink-0 w-40 aspect-video rounded-lg overflow-hidden border border-[#1e2d45] group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="Vídeo de onboarding" className="w-full h-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/30 group-hover:bg-black/10 transition-colors">
              <span className="w-11 h-11 rounded-full bg-white/20 backdrop-blur border border-white/50 grid place-items-center text-white">
                <Play className="w-5 h-5" fill="currentColor" />
              </span>
            </span>
          </a>
        ) : (
          <div className="flex-shrink-0 w-40 aspect-video rounded-lg border border-dashed border-[#2a3d56] grid place-items-center text-slate-600 text-3xl">
            🎬
          </div>
        )}

        {/* Config */}
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="w-4 h-4 text-purple-400" strokeWidth={2.25} />
            <h2 className="text-white font-bold text-sm">Onboarding do LeadHub</h2>
          </div>
          <p className="text-slate-400 text-xs mb-3 leading-relaxed">
            Vídeo fixo de introdução — todo cliente com o módulo de Vídeos (inclusive plano Free) vê
            este vídeo em destaque no topo da Central de vídeos, como “🚀 Comece por aqui”. É o mesmo
            vídeo enviado no e-mail de acesso. Não precisa cadastrar como trilha.
          </p>
          <form onSubmit={save} className="flex items-center gap-2 flex-wrap">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtu.be/xxxxxxxxxxx"
              className="flex-1 min-w-[220px] bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              {saved ? <><Check className="w-4 h-4" /> Salvo</> : saving ? "Salvando..." : "Salvar"}
            </button>
            {id && (
              <a
                href={url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg border border-[#1e2d45] text-slate-300 hover:text-white hover:bg-white/5 text-sm inline-flex items-center gap-1.5 transition-colors"
              >
                <Play className="w-4 h-4" /> Assistir
              </a>
            )}
          </form>
          {url.trim() && !id && (
            <p className="text-amber-400 text-[11px] mt-2">Não reconheci um link do YouTube válido — confira a URL.</p>
          )}
        </div>
      </div>
    </section>
  );
}

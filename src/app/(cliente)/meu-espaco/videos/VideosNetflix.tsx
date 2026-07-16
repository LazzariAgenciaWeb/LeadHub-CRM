"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play, ArrowLeft, X } from "lucide-react";

type Video = {
  id: string;
  title: string;
  description: string | null;
  youtubeId: string;
  thumbnailUrl: string | null;
  durationLabel: string | null;
};
type Category = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  accent: string | null;
  videos: Video[];
};

const thumb = (v: Video) => v.thumbnailUrl || `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`;
const embed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`;

export default function VideosNetflix({ categories, clientName }: { categories: Category[]; clientName: string }) {
  const [active, setActive] = useState<Video | null>(null);

  // Fecha no ESC + trava o scroll do fundo quando o player está aberto.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(null); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [active]);

  const featured = categories[0]?.videos[0] ?? null;

  return (
    <div className="vid">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <Link href="/meu-espaco" className="back"><ArrowLeft size={15} /> Voltar ao meu espaço</Link>

      {/* HERO */}
      <section className="hero" style={featured ? { backgroundImage: `linear-gradient(90deg,rgba(6,7,12,.94),rgba(6,7,12,.55) 55%,rgba(6,7,12,.2)),url(${thumb(featured)})` } : undefined}>
        <div className="heroin">
          <div className="eyebrow">Central de vídeos · {clientName}</div>
          {featured ? (
            <>
              <h1>{featured.title}</h1>
              {featured.description && <p>{featured.description}</p>}
              <button className="play" onClick={() => setActive(featured)}><Play size={17} fill="currentColor" /> Assistir agora</button>
            </>
          ) : (
            <>
              <h1>Seus materiais em vídeo</h1>
              <p>Assim que a gente publicar conteúdos pra você, eles aparecem aqui.</p>
            </>
          )}
        </div>
      </section>

      {/* FILEIRAS */}
      {categories.length === 0 ? (
        <div className="empty">Nenhum vídeo disponível ainda. 🎬</div>
      ) : (
        categories.map((cat) => (
          <section className="row" key={cat.id}>
            <div className="rowhead">
              <h2>{cat.emoji ? `${cat.emoji} ` : ""}{cat.title}</h2>
              {cat.description && <span className="sub">{cat.description}</span>}
            </div>
            <div className="rail">
              {cat.videos.map((v) => (
                <button key={v.id} className="card" onClick={() => setActive(v)}>
                  <div className="thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb(v)} alt={v.title} loading="lazy" />
                    <span className="playdot"><Play size={18} fill="currentColor" /></span>
                    {v.durationLabel && <span className="dur">{v.durationLabel}</span>}
                  </div>
                  <div className="cbody"><span className="ctitle">{v.title}</span></div>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {/* PLAYER */}
      {active && (
        <div className="ov" onClick={() => setActive(null)}>
          <div className="player" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setActive(null)} aria-label="Fechar"><X size={18} /></button>
            <div className="frame">
              <iframe
                src={embed(active.youtubeId)}
                title={active.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <div className="pinfo">
              <h3>{active.title}</h3>
              {active.description && <p>{active.description}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.vid{--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);color:var(--ink)}
.vid *{box-sizing:border-box}
.back{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--ink3);text-decoration:none;margin-bottom:16px}
.back:hover{color:var(--ink)}
.hero{position:relative;overflow:hidden;border-radius:22px;min-height:300px;display:flex;align-items:flex-end;
  background:#0A0C14;background-size:cover;background-position:center;border:1px solid var(--line2);
  box-shadow:0 40px 90px -46px rgba(0,0,0,.85)}
.heroin{padding:30px 32px 34px;max-width:640px}
.hero .eyebrow{font-size:11.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:rgba(243,244,248,.62)}
.hero h1{margin:10px 0 8px;font-size:30px;line-height:1.12;font-weight:820;letter-spacing:-.025em;color:#fff;text-wrap:balance}
.hero p{margin:0 0 18px;color:rgba(243,244,248,.8);font-size:14.5px;max-width:52ch;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.play{display:inline-flex;align-items:center;gap:9px;font-size:14px;font-weight:720;color:#0B0E14;cursor:pointer;
  background:#fff;border:none;border-radius:11px;padding:11px 20px;transition:transform .15s,box-shadow .15s}
.play:hover{transform:translateY(-2px);box-shadow:0 18px 34px -16px rgba(255,255,255,.5)}
.row{margin-top:30px}
.rowhead{display:flex;align-items:baseline;gap:10px;margin:0 2px 12px}
.rowhead h2{margin:0;font-size:17px;font-weight:760;letter-spacing:-.01em}
.rowhead .sub{font-size:12.5px;color:var(--ink3)}
.rail{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x mandatory}
.rail::-webkit-scrollbar{height:7px}.rail::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:99px}
.rail>*{scroll-snap-align:start;flex:none}
.card{width:280px;text-align:left;cursor:pointer;background:none;border:none;padding:0;color:inherit;
  border-radius:14px;transition:transform .18s}
.card:hover{transform:translateY(-5px)}
.thumb{position:relative;aspect-ratio:16/9;border-radius:13px;overflow:hidden;background:#000;
  border:1px solid var(--line);box-shadow:0 22px 44px -30px rgba(0,0,0,.9)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s,filter .2s}
.card:hover .thumb img{transform:scale(1.06);filter:brightness(.7)}
.thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(0,0,0,.5));opacity:.7}
.playdot{position:absolute;inset:0;margin:auto;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;
  background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border:1.5px solid rgba(255,255,255,.5);color:#fff;
  opacity:0;transform:scale(.8);transition:opacity .2s,transform .2s;z-index:1}
.card:hover .playdot{opacity:1;transform:scale(1)}
.dur{position:absolute;bottom:8px;right:8px;z-index:1;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.8);color:#fff}
.cbody{padding:10px 4px 2px}
.ctitle{font-size:13.5px;font-weight:600;color:var(--ink);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{color:var(--ink3);font-size:14px;padding:60px 26px;border:1px dashed var(--line2);border-radius:16px;text-align:center;margin-top:24px}
/* Player modal */
.ov{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(0,0,0,.82);backdrop-filter:blur(6px)}
.player{width:100%;max-width:920px;background:#0B0E16;border:1px solid var(--line2);border-radius:16px;overflow:hidden;
  box-shadow:0 50px 110px -40px rgba(0,0,0,.95);position:relative}
.close{position:absolute;top:10px;right:10px;z-index:2;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
  background:rgba(0,0,0,.55);border:1px solid var(--line2);color:#fff;cursor:pointer}
.close:hover{background:rgba(0,0,0,.8)}
.frame{position:relative;aspect-ratio:16/9;background:#000}
.frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.pinfo{padding:16px 20px 20px}
.pinfo h3{margin:0 0 6px;font-size:17px;font-weight:720;letter-spacing:-.01em}
.pinfo p{margin:0;color:var(--ink2);font-size:13.5px;line-height:1.5;white-space:pre-wrap}
@media(max-width:560px){.hero h1{font-size:24px}.card{width:230px}}
`;

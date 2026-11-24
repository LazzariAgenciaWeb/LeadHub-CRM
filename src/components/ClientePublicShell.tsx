import type { CSSProperties, ReactNode } from "react";

/**
 * Casca visual dos links públicos que o CLIENTE abre sem login: a peça pra
 * aprovar (/aprovar) e o chamado (/acompanhar). Mesmo fundo, cor da agência
 * como acento, cabeçalho com a logo no topo e os mesmos cartões/botões — o
 * cliente reconhece que é a mesma agência nas duas telas.
 *
 * Sem "use client": serve tanto a página do servidor (chamado) quanto o
 * componente de cliente (aprovação). Cada tela soma o próprio CSS depois deste.
 */

export const SHELL_CSS = `
.ap{--accent:var(--brand,#6E86FF);--ok:#4FD1A0;--warn:#F5B564;--ink:#F3F5FA;--ink2:#AFB6C6;--ink3:#727A8C;
  --line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--card:rgba(255,255,255,.04);
  min-height:100vh;color:var(--ink);background:radial-gradient(110% 70% at 85% -10%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 60%),#06070C;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
.ap *{box-sizing:border-box}
.apw{max-width:1240px;margin:0 auto;padding:22px 16px 180px}
.eyebrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--ink3)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);font-size:11px;font-weight:600;color:var(--ink2)}
.chip.warn{color:var(--warn);border-color:rgba(245,181,100,.35);background:rgba(245,181,100,.08)}
.chip.ok{color:var(--ok);border-color:rgba(79,209,160,.35);background:rgba(79,209,160,.08)}
h1{font-size:clamp(22px,2.4vw,30px);line-height:1.25;margin:10px 0 4px;letter-spacing:-.01em}
.sub{color:var(--ink3);font-size:13px}
.card{margin-top:16px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.card h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3)}
.pre{white-space:pre-wrap;word-break:break-word;font-size:14px;color:var(--ink2)}
.pre img{display:block;max-width:100%;margin:10px 0;border-radius:10px;border:1px solid var(--line)}
input.f,textarea.f{width:100%;background:#0B0D15;border:1px solid var(--line2);border-radius:12px;color:var(--ink);padding:11px 12px;font-size:16px;font-family:inherit}
textarea.f{min-height:84px;resize:vertical}
input.f:focus,textarea.f:focus{outline:none;border-color:var(--accent)}
.btn{flex:1;border:0;border-radius:14px;padding:14px 12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}
.btn:disabled{opacity:.5;cursor:default}
.btn.ok{background:var(--accent);color:var(--on-accent,#04150F)}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line2)}
.brandbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.brandbar img{height:30px;width:auto;max-width:150px;object-fit:contain;display:block}
.brandbar b{font-size:15px;letter-spacing:-.01em}
.brandbar>span,.brandbar .bbr>span{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
.brandbar .bbr{display:flex;align-items:center;gap:12px;min-width:0}
@media (max-width:560px){.brandbar .bbr>span{display:none}}
.made{margin-top:28px;text-align:center;font-size:11px;color:var(--ink3)}
.err{color:#FF8A8A;font-size:13px}
.banner{margin-top:18px;padding:16px;border-radius:16px;font-size:14px}
.banner.ok{background:rgba(79,209,160,.1);border:1px solid rgba(79,209,160,.35);color:#BDF3DF}
.banner.info{background:rgba(110,134,255,.1);border:1px solid rgba(110,134,255,.3);color:#D5DCFF}
.hint{font-size:12px;color:var(--ink3)}
`;

export type Brand = { name: string; logoUrl: string | null; color: string | null };

/**
 * Cor da agência vira o acento da tela; o texto em cima dela (botão principal)
 * fica escuro ou claro conforme a luminância — amarelo pede texto preto.
 */
export function brandVars(color: string | null): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { ["--brand" as string]: color, ["--on-accent" as string]: lum > 0.55 ? "#0A0A0A" : "#FFFFFF" } as CSSProperties;
}

/** Cabeçalho: logo da agência (ou o nome), o rótulo da tela e um botão à direita. */
export function BrandBar({ brand, label, children }: { brand: Brand; label: string; children?: ReactNode }) {
  return (
    <div className="brandbar">
      {brand.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={brand.logoUrl} alt={brand.name} />
        : <b>{brand.name}</b>}
      <div className="bbr">
        <span>{label}</span>
        {children}
      </div>
    </div>
  );
}

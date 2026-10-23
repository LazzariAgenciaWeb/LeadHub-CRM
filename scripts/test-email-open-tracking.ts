/**
 * Pixel de abertura: onde entra, se não duplica e se a cópia guardada fica
 * limpa. Rodar: npm run test:email-open-tracking
 */
process.env.NEXT_PUBLIC_BASE_URL = "https://app.exemplo.com.br";

import {
  injectOpenPixel, openPixelUrl, newTrackToken, TRACK_OPEN_PATH,
} from "../src/lib/email-open-tracking";

let falhas = 0;
function ok(nome: string, cond: boolean) {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}`);
}

const token = "abc123";

// ── URL ──
ok("URL usa a base pública e o caminho da rota",
  openPixelUrl(token) === `https://app.exemplo.com.br${TRACK_OPEN_PATH}?t=abc123`);
ok("token vai escapado na query",
  openPixelUrl("a+b/c=").includes("t=a%2Bb%2Fc%3D"));

// ── Injeção ──
const comBody = injectOpenPixel("<html><body><p>Oi</p></body></html>", token);
ok("entra antes do </body>", /<img[^>]+>\s*<\/body>/i.test(comBody));
ok("pixel é invisível e 1x1",
  comBody.includes('width="1"') && comBody.includes('height="1"') && comBody.includes("display:none"));

const semBody = injectOpenPixel('<div style="font-family:Arial">Oi</div>', token);
ok("sem </body>, cola no fim", semBody.trimEnd().endsWith("/>"));
ok("não perde o corpo original", semBody.includes("Oi"));

ok("idempotente: não duplica o pixel",
  (injectOpenPixel(comBody, token).match(/track\/open/g) ?? []).length === 1);
ok("sem token, HTML sai igual",
  injectOpenPixel("<p>Oi</p>", "") === "<p>Oi</p>");

// ── Token ──
const t1 = newTrackToken(), t2 = newTrackToken();
ok("token é opaco e único", t1 !== t2 && t1.length >= 20 && /^[A-Za-z0-9_-]+$/.test(t1));

// ── A cópia guardada no GoHub não leva pixel ──
// (regra do sendInboxEmail: `html` é gravado, `htmlEnviado` é o que sai)
const html = "<div>Proposta</div>";
const htmlEnviado = injectOpenPixel(html, token);
ok("cópia guardada fica sem rastreio", !html.includes(TRACK_OPEN_PATH));
ok("o que sai leva o rastreio", htmlEnviado.includes(TRACK_OPEN_PATH));

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);

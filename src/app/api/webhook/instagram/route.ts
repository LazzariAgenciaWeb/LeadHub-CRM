import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/instagram-oauth";
import { processInstagramWebhook, type IgWebhookBody } from "@/lib/instagram";

/**
 * Webhook do Instagram (plataforma "API com Login do Instagram").
 *
 * GET  → handshake de verificação da Meta (hub.challenge).
 *        Configure no painel do app: Callback URL = este endpoint,
 *        Verify Token = INSTAGRAM_WEBHOOK_VERIFY_TOKEN.
 * POST → eventos. Assinados com X-Hub-Signature-256 (HMAC do App Secret sobre
 *        o corpo cru). Validamos a assinatura ANTES de processar.
 *
 * Campos assinados no painel: `comments` e `messages`.
 *
 * Multi-tenant: o payload traz `entry[].id` = id da conta IG; resolvemos a
 * empresa dona via InstagramAccount.igUserId dentro de processInstagramWebhook.
 */

// Buffer de diagnóstico em memória (últimos eventos) — mesmo padrão do webhook
// do WhatsApp. Single-instance; só pra inspeção rápida.
const recentEvents: { ts: string; object?: string; entries: number; note?: string }[] = [];

// ─── GET: verificação (handshake) ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    console.error("[Webhook IG] INSTAGRAM_WEBHOOK_VERIFY_TOKEN não configurado");
    return NextResponse.json({ error: "verify token não configurado" }, { status: 500 });
  }

  if (mode === "subscribe" && token === expected && challenge) {
    // A Meta exige o challenge cru (texto), não JSON.
    return new NextResponse(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "verificação falhou" }, { status: 403 });
}

// ─── POST: eventos ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Precisamos do corpo CRU pra validar a assinatura byte-a-byte.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  // Em produção a assinatura é obrigatória. Em dev sem App Secret, avisamos.
  if (process.env.INSTAGRAM_APP_SECRET) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn("[Webhook IG] assinatura inválida");
      return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "INSTAGRAM_APP_SECRET não configurado" }, { status: 500 });
  } else {
    console.warn("[Webhook IG] INSTAGRAM_APP_SECRET ausente — aceitando em dev");
  }

  let body: IgWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const entries = Array.isArray(body?.entry) ? body.entry.length : 0;
  console.log(`[Webhook IG] object=${body?.object} entries=${entries}`);
  recentEvents.unshift({ ts: new Date().toISOString(), object: body?.object, entries });
  if (recentEvents.length > 10) recentEvents.pop();

  // Processamento real (casar automações, responder, DM) vive em src/lib/instagram.ts.
  // Respondemos 200 rápido e processamos — a Meta reentrega em caso de erro/timeout.
  try {
    await processInstagramWebhook(body);
  } catch (e: any) {
    console.error("[Webhook IG] erro ao processar:", e?.message);
    // Mesmo com erro retornamos 200 pra evitar retry storm; o erro fica logado
    // e (Fase 2) registrado em IgAutomationRun.
  }

  return NextResponse.json({ ok: true });
}

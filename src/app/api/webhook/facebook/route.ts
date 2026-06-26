import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyFbSignature, fbTokenCrypto, fbGetUserName } from "@/lib/facebook";
import { recordIgMessage } from "@/lib/instagram";
import { recordFbWebhookEvent } from "@/lib/instagram-debug";

/**
 * Webhook da Página do Facebook (object "page") — DMs do Messenger.
 * GET: handshake (hub.challenge) com INSTAGRAM_WEBHOOK_VERIFY_TOKEN (mesmo token).
 * POST: valida X-Hub-Signature-256 (App Secret do FB) e persiste DMs na inbox.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "verificação falhou" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (process.env.FACEBOOK_APP_SECRET) {
    if (!verifyFbSignature(rawBody, signature)) {
      recordFbWebhookEvent({ type: "rejected", note: "assinatura inválida", hasSig: !!signature });
      return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "FACEBOOK_APP_SECRET ausente" }, { status: 500 });
  }

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  recordFbWebhookEvent({ type: "received", object: body?.object, entries: Array.isArray(body?.entry) ? body.entry.length : 0 });

  if (body?.object !== "page" || !Array.isArray(body.entry)) {
    return NextResponse.json({ ok: true });
  }

  try {
    for (const entry of body.entry) {
      const pageId = String(entry.id);
      const page = await prisma.facebookPage.findUnique({
        where: { pageId },
        select: { companyId: true, pageAccessTokenEnc: true, status: true },
      });
      if (!page || page.status !== "ACTIVE") {
        recordFbWebhookEvent({ type: "page_not_found", pageId });
        continue;
      }
      const pageToken = fbTokenCrypto.decrypt(page.pageAccessTokenEnc);

      if (!Array.isArray(entry.messaging)) {
        recordFbWebhookEvent({ type: "no_messaging", pageId, keys: Object.keys(entry) });
      }
      for (const m of entry.messaging ?? []) {
        if (m.message?.is_echo) continue;
        const psid = m.sender?.id;
        if (!psid || psid === pageId) continue;
        const text = m.message?.text ?? (m.postback?.payload ? `[botão] ${m.postback.payload}` : null);
        recordFbWebhookEvent({ type: "message", pageId, psid, text });

        let username: string | null = null;
        if (pageToken) username = await fbGetUserName(psid, pageToken);

        await recordIgMessage({
          companyId: page.companyId,
          channel: "MESSENGER",
          connectionId: pageId,
          participantId: psid,
          username,
          direction: "IN",
          source: "ORGANIC",
          text,
          mid: m.message?.mid ?? null,
        }).catch((e) => console.error("[FB] persist:", e?.message));
      }
    }
  } catch (e: any) {
    console.error("[Webhook FB] erro:", e?.message);
  }

  return NextResponse.json({ ok: true });
}

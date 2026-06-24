import { NextResponse } from "next/server";
import { requireInstagramCompany, getCompanyAccount } from "@/lib/instagram-api";
import { decryptAccountToken, igGraphBase } from "@/lib/instagram";

// GET /api/instagram/media → posts recentes da conta (pra escolher na automação).
export async function GET() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const account = await getCompanyAccount(ctx.companyId);
  if (!account) return NextResponse.json({ error: "Nenhuma conta conectada" }, { status: 404 });

  const token = decryptAccountToken(account.accessTokenEnc);
  if (!token) return NextResponse.json({ error: "Conta sem token" }, { status: 400 });

  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
    limit: "24",
    access_token: token,
  });
  const r = await fetch(`${igGraphBase}/me/media?${params.toString()}`);
  if (!r.ok) {
    return NextResponse.json({ error: `Falha ao listar posts: ${r.status}` }, { status: 502 });
  }
  const j: any = await r.json();
  const media = (j.data ?? []).map((m: any) => ({
    id: m.id,
    caption: m.caption ?? "",
    mediaType: m.media_type,
    thumbnail: m.thumbnail_url || m.media_url || null,
    permalink: m.permalink,
    timestamp: m.timestamp,
  }));
  return NextResponse.json({ count: media.length, media });
}

import { NextResponse } from "next/server";
import { requireInstagramCompany, getCompanyAccount } from "@/lib/instagram-api";
import { decryptAccountToken } from "@/lib/instagram";
import { subscribeAccountWebhooks, getSubscribedApps } from "@/lib/instagram-oauth";

// POST /api/instagram/account/resubscribe
// Reassina a conta IG da empresa aos webhooks (comments, messages,
// messaging_postbacks). Botão "Atualizar conexão" na tela do módulo.
export async function POST() {
  const ctx = await requireInstagramCompany();
  if (!ctx.ok) return ctx.res;

  const account = await getCompanyAccount(ctx.companyId);
  if (!account) return NextResponse.json({ error: "Nenhuma conta conectada" }, { status: 404 });

  const token = decryptAccountToken(account.accessTokenEnc);
  if (!token) return NextResponse.json({ error: "Conta sem token" }, { status: 400 });

  const result = await subscribeAccountWebhooks(token);
  const status = await getSubscribedApps(token);
  const fields: string[] = status.body?.data?.[0]?.subscribed_fields ?? [];

  // Repassa o motivo real da Meta quando a assinatura falha (token vencido,
  // permissão faltando etc.) — antes a UI só mostrava "falhou".
  let error: string | undefined;
  if (!result.ok) {
    const metaMsg = result.body?.error?.message ?? (typeof result.body === "string" ? result.body : null);
    const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now();
    error = expired
      ? `Token da conta venceu em ${account.tokenExpiresAt!.toLocaleDateString("pt-BR")} — desconecte e conecte a conta de novo.`
      : `Meta recusou (HTTP ${result.status})${metaMsg ? `: ${metaMsg}` : ""}`;
    console.error(`[IG resubscribe] empresa=${ctx.companyId} conta=${account.id}:`, error);
  }

  return NextResponse.json({ ok: result.ok, fields, ...(error ? { error } : {}) });
}

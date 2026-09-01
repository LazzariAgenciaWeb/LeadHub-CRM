import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { authorizeVaultAccess } from "@/lib/vault-auth";
import {
  exchangeCodeForTokens,
  decodeIdToken,
  detectAuthorizedServices,
  tokenCrypto,
  type GoogleService,
} from "@/lib/google-oauth";

// Mapeia serviço autorizado → IntegrationProvider do schema.
// Calendar não entra aqui — é gerenciado por usuário em UserGoogleConnection.
const SERVICE_TO_PROVIDER: Partial<Record<GoogleService, "GA4" | "SEARCH_CONSOLE" | "BUSINESS_PROFILE" | "GOOGLE_ADS">> = {
  ga4: "GA4",
  sc: "SEARCH_CONSOLE",
  gbp: "BUSINESS_PROFILE",
  gads: "GOOGLE_ADS",
};

// GET /api/integrations/google/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Usuário cancelou ou Google retornou erro
  if (error) {
    return redirectToCompany(null, `?integration_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return redirectToCompany(null, "?integration_error=missing_params");
  }

  // Decodifica state
  let payload: { s: string; c: string; sv: GoogleService[] };
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectToCompany(null, "?integration_error=invalid_state");
  }

  // CSRF: confere com o cookie
  const cookieStore = await cookies();
  const cookieState = cookieStore.get("lh_oauth_state")?.value;
  if (!cookieState || cookieState !== payload.s) {
    return redirectToCompany(payload.c, "?integration_error=state_mismatch");
  }
  // Limpa o cookie de state
  cookieStore.delete("lh_oauth_state");

  // Reconfere permissão (importante: o usuário pode ter perdido acesso entre connect e callback).
  // Skip gate de cofre — o gate de marketing já foi feito em /connect.
  const auth = await authorizeVaultAccess(payload.c, { checkCofreModule: false });
  if (!auth.ok || !auth.canWrite) {
    return redirectToCompany(payload.c, "?integration_error=forbidden");
  }

  // Troca code por tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e: any) {
    console.error("[google-oauth] exchange failed:", e.message);
    return redirectToCompany(payload.c, `?integration_error=${encodeURIComponent("token_exchange_failed")}`);
  }

  // Detecta quais escopos foram efetivamente concedidos
  const grantedServices = detectAuthorizedServices(tokens.scope);
  if (grantedServices.length === 0) {
    return redirectToCompany(payload.c, "?integration_error=no_scopes_granted");
  }

  // Identifica o usuário Google que autorizou
  const idInfo = decodeIdToken(tokens.id_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Cria/atualiza um MarketingIntegration por serviço autorizado.
  //
  // Reconexão precisa ser IDEMPOTENTE: antes procurávamos só o registro com
  // accountId=null, então reconectar uma integração já configurada criava um
  // segundo registro ("selecione a propriedade") e deixava o antigo pendurado.
  // Agora renovamos o token DO registro existente, preservando a propriedade
  // escolhida — e, como o consentimento traz os escopos das outras conexões da
  // mesma conta Google, elas também são renovadas de uma vez só.
  const authEmail = (idInfo.email ?? "").toLowerCase();
  const requested = new Set(payload.sv);

  const tokenData: any = {
    accessTokenEnc: tokenCrypto.encrypt(tokens.access_token),
    tokenExpiresAt: expiresAt,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    googleEmail: idInfo.email ?? null,
    googleName: idInfo.name ?? null,
    status: "ACTIVE" as const,
    lastError: null,
  };
  // Refresh token só vem na primeira autorização (ou com prompt=consent) —
  // quando não vier, preservamos o que já está gravado.
  if (tokens.refresh_token) {
    tokenData.refreshTokenEnc = tokenCrypto.encrypt(tokens.refresh_token);
  }

  for (const service of grantedServices) {
    const provider = SERVICE_TO_PROVIDER[service];
    if (!provider) continue;

    const existing = await prisma.marketingIntegration.findMany({
      where: { companyId: payload.c, provider },
      orderBy: { createdAt: "asc" },
      select: { id: true, accountId: true, googleEmail: true },
    });

    // Só mexemos nas conexões da MESMA conta Google (ou nas antigas, sem email
    // gravado). Conexão feita com outra conta fica intacta.
    const sameAccount = existing.filter(
      (i) => !i.googleEmail || !authEmail || i.googleEmail.toLowerCase() === authEmail
    );

    if (sameAccount.length > 0) {
      await prisma.marketingIntegration.updateMany({
        where: { id: { in: sameAccount.map((i) => i.id) } },
        data: tokenData,
      });
      // Limpa resíduo de reconexões antigas: se já existe registro com
      // propriedade escolhida, o registro sem accountId é duplicata órfã
      // (nunca sincronizou nada — não há histórico preso a ele).
      const orphans = sameAccount.filter((i) => !i.accountId);
      if (orphans.length > 0 && sameAccount.some((i) => i.accountId)) {
        await prisma.marketingIntegration.deleteMany({
          where: { id: { in: orphans.map((i) => i.id) } },
        });
      }
      continue;
    }

    // Nenhuma conexão desta conta Google ainda. Escopo que veio de carona
    // (include_granted_scopes) não pode inventar integração que a empresa
    // nunca pediu — só criamos registro pro serviço que o usuário clicou.
    if (!requested.has(service)) continue;

    // Registro-raiz sem accountId de outra conta Google: reaproveita (o
    // @@unique(companyId, provider, accountId) não deixaria criar outro).
    const rootless = existing.find((i) => !i.accountId);
    if (rootless) {
      await prisma.marketingIntegration.update({ where: { id: rootless.id }, data: tokenData });
      continue;
    }

    await prisma.marketingIntegration.create({
      data: {
        ...tokenData,
        companyId: payload.c,
        provider,
        accountId: null, // ainda não escolheu propriedade — fluxo seguinte
        createdById: auth.userId,
      },
    });
  }

  return redirectToCompany(payload.c, "?integration_success=1");
}

function redirectToCompany(companyId: string | null, qs: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const path = companyId ? `/empresas/${companyId}` : "/empresas";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}${path}${qs}`);
}

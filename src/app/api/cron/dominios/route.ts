import { NextRequest, NextResponse } from "next/server";
import { refreshPendingDomains } from "@/lib/bio-domain-server";

/**
 * GET/POST /api/cron/dominios
 *
 * Reconfere os domínios próprios que ainda não estão no ar: a validação da
 * posse e a emissão do certificado acontecem do lado da Cloudflare, em minutos
 * ou horas, e ninguém fica apertando "Verificar agora". Domínio ativo e domínio
 * travado à mão pelo super admin ficam de fora.
 *
 * Roda a cada 10 minutos (start.sh).
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await refreshPendingDomains();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

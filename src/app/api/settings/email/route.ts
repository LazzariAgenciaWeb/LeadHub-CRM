import { NextRequest, NextResponse } from "next/server";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { getSmtpConfig, resetSmtpCache } from "@/lib/email";

// GET /api/settings/email — retorna a config (sem expor a senha)
export async function GET() {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const role = (session.user as any)?.role;
  if (role !== "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const cfg = await getSmtpConfig();
  return NextResponse.json({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    hasPassword: !!cfg.pass,
    configured: cfg.configured,
  });
}

// PUT /api/settings/email — salva config no Setting (key-value)
// Body: { host, port, secure, user, from, password? }
//   password só é gravada se informada (preserva a anterior se omitida)
export async function PUT(req: NextRequest) {
  const session = await getEffectiveSession();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const role = (session.user as any)?.role;
  if (role !== "SUPER_ADMIN") return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const host: string   = String(body.host ?? "").trim();
  const port: number   = parseInt(String(body.port ?? "465"), 10) || 465;
  const secure: boolean = Boolean(body.secure ?? true);
  const user: string   = String(body.user ?? "").trim();
  const from: string   = String(body.from ?? "").trim();
  const password: string | undefined = typeof body.password === "string" ? body.password : undefined;

  if (!host || !user) {
    return NextResponse.json({ error: "host e user são obrigatórios" }, { status: 400 });
  }

  // Upserts em paralelo (mesma tabela Setting, várias chaves)
  const ops: Array<Promise<unknown>> = [
    prisma.setting.upsert({ where: { key: "smtp.host"   }, update: { value: host },           create: { key: "smtp.host",   value: host } }),
    prisma.setting.upsert({ where: { key: "smtp.port"   }, update: { value: String(port) },   create: { key: "smtp.port",   value: String(port) } }),
    prisma.setting.upsert({ where: { key: "smtp.secure" }, update: { value: String(secure) },create: { key: "smtp.secure", value: String(secure) } }),
    prisma.setting.upsert({ where: { key: "smtp.user"   }, update: { value: user },           create: { key: "smtp.user",   value: user } }),
    prisma.setting.upsert({ where: { key: "smtp.from"   }, update: { value: from },           create: { key: "smtp.from",   value: from } }),
  ];
  if (password) {
    const enc = encryptSecret(password);
    ops.push(prisma.setting.upsert({ where: { key: "smtp.passEnc" }, update: { value: enc }, create: { key: "smtp.passEnc", value: enc } }));
  }
  await Promise.all(ops);
  resetSmtpCache();

  return NextResponse.json({ ok: true });
}

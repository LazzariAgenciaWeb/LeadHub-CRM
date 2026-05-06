import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Perfil do próprio usuário logado.
// Usa sessão REAL (não impersonada): mesmo super admin impersonando edita o
// próprio perfil, não o do cliente fictício.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      whatsappSignature: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user as any).id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const data: { name?: string; whatsappSignature?: string | null } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name inválido" }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      return NextResponse.json({ error: "Nome deve ter entre 2 e 80 caracteres" }, { status: 400 });
    }
    data.name = trimmed;
  }

  if (body.whatsappSignature !== undefined) {
    if (body.whatsappSignature === null || body.whatsappSignature === "") {
      data.whatsappSignature = null;
    } else if (typeof body.whatsappSignature === "string") {
      const sig = body.whatsappSignature.trim();
      if (sig.length > 120) {
        return NextResponse.json({ error: "Assinatura deve ter no máximo 120 caracteres" }, { status: 400 });
      }
      data.whatsappSignature = sig.length === 0 ? null : sig;
    } else {
      return NextResponse.json({ error: "whatsappSignature inválido" }, { status: 400 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      whatsappSignature: true,
    },
  });

  return NextResponse.json(updated);
}

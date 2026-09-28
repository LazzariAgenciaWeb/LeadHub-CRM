import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { hasModule, can, isSuperAdmin } from "@/lib/permissions";
import { getAnthropicConfig } from "@/lib/anthropic";
import { getOpenAIConfig } from "@/lib/openai";
import { getAssistantProvider } from "@/lib/personal-assistant/engine";
import AssistantHome from "./AssistantHome";

/**
 * /assistente — home do assistente pessoal.
 * Não é painel: é chat (texto/áudio) + fila de próximas ações + bloquinho.
 * Age em nome do usuário logado REAL (mesmo com impersonação ativa).
 */
export default async function AssistentePage() {
  const real = await getServerSession(authOptions);
  if (!real) redirect("/login");
  const eff = (await getEffectiveSession()) ?? real;
  if (!isSuperAdmin(real) && !(hasModule(eff, "assistentePessoal") && can(eff, "canUseAI"))) redirect("/dashboard");

  const userId = (real.user as any).id as string;
  const [me, provider] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, assistantGroupJid: true, companyId: true, role: true } }),
    getAssistantProvider(),
  ]);
  if (!me) redirect("/login");
  const aiConfigured = provider.name === "openai" ? !!(await getOpenAIConfig()) : !!(await getAnthropicConfig());

  return (
    <AssistantHome
      userName={me.name}
      whatsappLinked={!!me.assistantGroupJid}
      aiConfigured={aiConfigured}
      canConfigureAi={isSuperAdmin(real)}
      hasCompany={!!me.companyId}
    />
  );
}

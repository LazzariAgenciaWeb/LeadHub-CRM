import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveSession, getActingSession } from "@/lib/effective-session";
import { prisma } from "@/lib/prisma";
import { hasModule, can, isSuperAdmin } from "@/lib/permissions";
import { getAnthropicConfig } from "@/lib/anthropic";
import { getOpenAIConfig } from "@/lib/openai";
import { getAssistantProvider } from "@/lib/personal-assistant/engine";
import { getAiSpend } from "@/lib/ai-costs";
import AssistantHome from "./AssistantHome";

/**
 * /assistente — home do assistente pessoal.
 * Não é painel: é chat (texto/áudio) + fila de próximas ações + bloquinho.
 * Age em nome da identidade em vigor: o usuário logado REAL, ou a conta
 * vinculada quando o super admin impersona uma empresa onde "ele é" alguém.
 */
export default async function AssistentePage() {
  const real = await getServerSession(authOptions);
  if (!real) redirect("/login");
  const eff = (await getEffectiveSession()) ?? real;
  if (!isSuperAdmin(real) && !(hasModule(eff, "assistentePessoal") && can(eff, "canUseAI"))) redirect("/dashboard");

  const acting = (await getActingSession()) ?? real;
  const userId = (acting.user as any).id as string;
  const [me, provider] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, assistantGroupJid: true, companyId: true, role: true } }),
    getAssistantProvider(),
  ]);
  if (!me) redirect("/login");
  const aiConfigured = provider.name === "openai" ? !!(await getOpenAIConfig()) : !!(await getAnthropicConfig());
  // Gasto só do assistente pessoal (endpoints assistente-*), da empresa do usuário.
  const spend = me.companyId ? await getAiSpend(me.companyId, { endpointPrefix: "assistente-" }) : null;

  return (
    <AssistantHome
      userName={me.name}
      whatsappLinked={!!me.assistantGroupJid}
      aiConfigured={aiConfigured}
      spend={spend ? { todayUSD: spend.todayUSD, monthUSD: spend.monthUSD, todayCalls: spend.todayCalls, model: provider.name === "openai" ? provider.model : (await getAnthropicConfig())?.model ?? null } : null}
      canConfigureAi={isSuperAdmin(real)}
      hasCompany={!!me.companyId}
    />
  );
}

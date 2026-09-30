import { prisma } from "@/lib/prisma";
import { evolutionSetSettings } from "@/lib/evolution";

/**
 * "Grupos OFF" + assistente pessoal na mesma instância.
 *
 * O toggle da instância (`acceptGroups=false`) vira `groupsIgnore=true` na
 * Evolution — que descarta TODO grupo na origem, inclusive o grupo do
 * assistente. Pra permitir "só o grupo do assistente", quando há um grupo
 * vinculado a Evolution continua entregando grupos e quem filtra é o webhook
 * do GoHub (descarta qualquer grupo que não seja o do assistente).
 */
export async function instanceHasAssistantGroup(instanceId: string): Promise<boolean> {
  const n = await prisma.user.count({ where: { assistantInstanceId: instanceId, assistantGroupJid: { not: null } } });
  return n > 0;
}

/** Valor que deve ir pro `groupsIgnore` da Evolution. */
export async function effectiveGroupsIgnore(inst: { id: string; acceptGroups: boolean }): Promise<boolean> {
  if (inst.acceptGroups) return false;
  return !(await instanceHasAssistantGroup(inst.id));
}

/** Reaplica o `groupsIgnore` da instância (após parear/desvincular). Nunca lança. */
export async function syncGroupsIgnore(instanceId: string): Promise<void> {
  try {
    const inst = await prisma.whatsappInstance.findUnique({
      where: { id: instanceId },
      select: { id: true, instanceName: true, instanceToken: true, acceptGroups: true },
    });
    if (!inst) return;
    await evolutionSetSettings(inst.instanceName, { groupsIgnore: await effectiveGroupsIgnore(inst) }, inst.instanceToken ?? null);
  } catch (e) {
    console.warn("[assistente] falha ao sincronizar groupsIgnore:", e);
  }
}

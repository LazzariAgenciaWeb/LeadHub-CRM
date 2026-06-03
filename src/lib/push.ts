/**
 * Helpers de Web Push notifications.
 *
 * Setup obrigatório (1x):
 *   1. Rodar `npx tsx scripts/generate-vapid-keys.ts` — imprime VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.
 *   2. Adicionar as 3 envs no painel do Coolify (e .env local quando houver):
 *      - VAPID_PUBLIC_KEY=<chave pública>
 *      - VAPID_PRIVATE_KEY=<chave privada>
 *      - VAPID_SUBJECT=mailto:diego@lazzari.net.br
 *      - NEXT_PUBLIC_VAPID_PUBLIC_KEY=<mesma chave pública>  (frontend lê essa)
 *   3. Redeploy.
 *
 * Sem essas envs, `sendPushToUser` vira no-op silencioso e a UI também esconde
 * o botão de "Receber alertas" — deploy seguro mesmo sem keys configuradas.
 */
import webpush from "web-push";
import { prisma } from "./prisma";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:contato@leadhub.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  /** URL pra abrir ao clicar (relativa). */
  url?: string;
  /** Tag pra agrupar/atualizar notificações (1 por conversa por exemplo). */
  tag?: string;
  /** Ícone (deve estar em /public). Padrão: /icon-192.png se existir, senão favicon. */
  icon?: string;
  /** Imagem de fundo grande (opcional). */
  image?: string;
}

/**
 * Dispara push pra todas as subscriptions ativas do usuário.
 * Filtra por `categoryFilter` se passado — checa UserNotifPreferences.
 *
 * fire-and-forget: nunca lança. Erros 410/404 limpam a sub. Outros incrementam failCount.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  categoryFilter?: "newMessage" | "hotSignal" | "taskOverdue" | "followUp"
): Promise<void> {
  if (!ensureConfigured()) return;

  try {
    if (categoryFilter) {
      const prefs = await prisma.userNotifPreferences.findUnique({ where: { userId } });
      // Default = ligado pra tudo MENOS taskOverdue (que ainda não tem cron).
      // followUp default ligado → cai no ramo `!== "taskOverdue"` = true.
      const enabled = prefs
        ? (prefs as any)[categoryFilter] !== false
        : (categoryFilter !== "taskOverdue");
      if (!enabled) return;
    }

    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          );
        } catch (err: any) {
          const status = err?.statusCode ?? 0;
          if (status === 404 || status === 410) {
            // Sub morta — apaga
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => null);
          } else {
            await prisma.pushSubscription.update({
              where: { id: s.id },
              data: { failCount: { increment: 1 }, lastFailedAt: new Date() },
            }).catch(() => null);
          }
        }
      })
    );
  } catch {
    // Nunca propaga
  }
}

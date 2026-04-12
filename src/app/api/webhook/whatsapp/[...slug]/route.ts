/**
 * Rota catch-all para webhooks da Evolution API com webhookByEvents=true.
 * Quando webhookByEvents está ativo, a Evolution envia para:
 *   /api/webhook/whatsapp/MESSAGES_UPSERT
 *   /api/webhook/whatsapp/CONNECTION_UPDATE
 *   etc.
 * Esta rota captura todos esses sub-caminhos e redireciona para o handler principal.
 */

export { POST, GET } from "../route";

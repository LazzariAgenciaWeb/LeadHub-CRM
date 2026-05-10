/**
 * Gera um par de chaves VAPID pra Web Push e imprime as envs prontas.
 *
 * Uso:
 *   npx tsx scripts/generate-vapid-keys.ts
 *
 * Saída: 4 linhas pra colar no painel de envs do Coolify (e no .env local).
 * Rode UMA vez por ambiente (prod usa um par, dev local pode usar outro).
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("");
console.log("✅ Chaves VAPID geradas. Copie no painel de envs do Coolify (e .env local):");
console.log("");
console.log(`VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:diego@lazzari.net.br"`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log("");
console.log("⚠️  GUARDE A PRIVATE_KEY EM LOCAL SEGURO. Trocá-la invalida todas as inscrições atuais.");

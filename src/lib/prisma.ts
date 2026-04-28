import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makePrismaClient> | undefined;
};

/**
 * Cria um PrismaClient com retry automático para erros de conexão transitórios.
 *
 * Contexto: em ambientes de longa duração (Docker/Railway), o PostgreSQL pode
 * fechar conexões idle. Quando o Prisma tenta reutilizar uma dessas conexões
 * recebe "Socket not connected (code 107)" / ECONNRESET. O $extends intercepta
 * todas as operações e refaz automaticamente até 3 vezes com backoff de 250ms.
 */
function makePrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (e: any) {
            const msg: string = e?.message ?? "";
            const code: string = e?.code ?? "";

            const isConnectionError =
              msg.includes("Socket not connected") ||
              msg.includes("ECONNRESET") ||
              msg.includes("Connection refused") ||
              msg.includes("ENOTCONN") ||
              // Prisma error codes: Can't reach DB / Connection timed out / Closed conn
              ["P1001", "P1002", "P1008", "P1017"].includes(code);

            if (isConnectionError && attempt < MAX_RETRIES - 1) {
              const delay = (attempt + 1) * 250; // 250ms, 500ms
              console.warn(
                `[Prisma] Erro de conexão (tentativa ${attempt + 1}/${MAX_RETRIES}), aguardando ${delay}ms: ${msg}`
              );
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            throw e;
          }
        }

        // Nunca deve chegar aqui, mas satisfaz o TypeScript
        throw new Error("[Prisma] Número máximo de tentativas excedido");
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import { prisma } from "./prisma";

async function getConfig() {
  const settings = await prisma.setting.findMany({
    where: { key: { in: ["evolution_base_url", "evolution_api_key"] } },
  });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  const baseUrl = map["evolution_base_url"]?.replace(/\/$/, "");
  const apiKey = map["evolution_api_key"];

  if (!baseUrl || !apiKey) throw new Error("Evolution API não configurada. Vá em Configurações.");

  return { baseUrl, apiKey };
}

function headers(apiKey: string) {
  return {
    "Content-Type": "application/json",
    apikey: apiKey,
  };
}

/** Cria a instância na Evolution API */
export async function evolutionCreateInstance(instanceName: string, webhookUrl: string) {
  const { baseUrl, apiKey } = await getConfig();

  const res = await fetch(`${baseUrl}/instance/create`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution create: ${res.status} ${err}`);
  }
  return res.json();
}

/** Busca token da instância via fetchInstances (para autenticar endpoints que precisam do token) */
async function evolutionGetInstanceToken(instanceName: string): Promise<string | null> {
  const { baseUrl, apiKey } = await getConfig();
  try {
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: headers(apiKey),
    });
    if (!res.ok) return null;
    const list: any[] = await res.json();
    const found = list.find((i: any) => i.name === instanceName || i.instanceName === instanceName);
    return found?.token ?? null;
  } catch {
    return null;
  }
}

/** Busca o QR code de uma instância */
export async function evolutionGetQR(instanceName: string) {
  const { baseUrl, apiKey } = await getConfig();

  // No v2, connect/{name} pode exigir o token da instância
  const instanceToken = await evolutionGetInstanceToken(instanceName);
  const authKey = instanceToken ?? apiKey;

  const res = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
    headers: headers(authKey),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution QR: ${res.status} ${err}`);
  }
  return res.json(); // { base64: "data:image/png;base64,..." }
}

/** Status da instância
 * Evolution API v2: connectionState/{name} exige token da instância (401 com chave global).
 * Usamos fetchInstances que funciona com a chave global e retorna connectionStatus de todas.
 */
export async function evolutionGetStatus(instanceName: string) {
  const { baseUrl, apiKey } = await getConfig();

  // Tenta primeiro via fetchInstances (funciona com chave global no v2)
  try {
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: headers(apiKey),
    });
    if (res.ok) {
      const list: any[] = await res.json();
      const found = list.find(
        (i: any) => i.name === instanceName || i.instanceName === instanceName
      );
      if (found) {
        // Normaliza para o formato esperado pelo sync
        const state = found.connectionStatus ?? found.state ?? "close";
        return { instance: { state } };
      }
    }
  } catch {}

  // Fallback: tenta connectionState diretamente (funciona no v1)
  const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
    headers: headers(apiKey),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Envia mensagem de texto */
export async function evolutionSendText(instanceName: string, phone: string, text: string) {
  const { baseUrl, apiKey } = await getConfig();

  // Garante formato correto: 5511999999999@s.whatsapp.net
  const number = phone.replace(/\D/g, "");

  const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      number,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution send: ${res.status} ${err}`);
  }
  return res.json();
}

/** Desconecta / deleta instância da Evolution */
export async function evolutionDeleteInstance(instanceName: string) {
  const { baseUrl, apiKey } = await getConfig();

  await fetch(`${baseUrl}/instance/logout/${instanceName}`, {
    method: "DELETE",
    headers: headers(apiKey),
  }).catch(() => {});

  await fetch(`${baseUrl}/instance/delete/${instanceName}`, {
    method: "DELETE",
    headers: headers(apiKey),
  }).catch(() => {});
}

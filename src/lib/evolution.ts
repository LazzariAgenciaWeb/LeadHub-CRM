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
export async function evolutionGetQR(instanceName: string, instanceToken?: string | null) {
  const { baseUrl, apiKey } = await getConfig();

  // Prioridade: token da instância > buscar via fetchInstances > chave global
  const token = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;

  const res = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
    headers: headers(token),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution QR: ${res.status} ${err}`);
  }
  return res.json(); // { base64: "data:image/png;base64,..." }
}

/** Status da instância
 * Evolution API v2: connectionState/{name} exige token da instância.
 * instanceToken: token específico da instância (campo instanceToken no DB).
 */
export async function evolutionGetStatus(instanceName: string, instanceToken?: string | null) {
  const { baseUrl, apiKey } = await getConfig();

  // Se temos o token da instância, usa direto no connectionState
  if (instanceToken) {
    try {
      const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
        headers: headers(instanceToken),
      });
      if (res.ok) {
        const data = await res.json();
        const state = data?.instance?.state ?? data?.state ?? data?.connectionStatus ?? "close";
        return { instance: { state } };
      }
    } catch {}
  }

  // Fallback: fetchInstances com chave global (retorna só as instâncias do mesmo token)
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
        const state = found.connectionStatus ?? found.state ?? "close";
        return { instance: { state } };
      }
    }
  } catch {}

  return null;
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

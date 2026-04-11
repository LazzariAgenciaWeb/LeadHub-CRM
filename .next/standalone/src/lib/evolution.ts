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

/** Busca o QR code de uma instância */
export async function evolutionGetQR(instanceName: string) {
  const { baseUrl, apiKey } = await getConfig();

  const res = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
    headers: headers(apiKey),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution QR: ${res.status} ${err}`);
  }
  return res.json(); // { base64: "data:image/png;base64,..." }
}

/** Status da instância */
export async function evolutionGetStatus(instanceName: string) {
  const { baseUrl, apiKey } = await getConfig();

  const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
    headers: headers(apiKey),
  });

  if (!res.ok) return null;
  return res.json(); // { instance: { state: "open" | "close" | "connecting" } }
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

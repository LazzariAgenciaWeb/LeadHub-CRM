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

/**
 * Gera um slug técnico seguro para o instanceName da Evolution a partir do
 * nome da empresa. Sem acento/espaço/maiúscula + sufixo aleatório de 6 chars
 * pra garantir unicidade (a Evolution rejeita nomes duplicados). O caller
 * ainda deve checar colisão no banco e regenerar no caso raro de empate.
 */
export function buildInstanceSlug(companyName: string): string {
  const base = (companyName || "instancia")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")        // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, "")            // tira hífen das pontas
    .slice(0, 24)
    || "instancia";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/**
 * Lê o número de telefone real conectado na instância via fetchInstances
 * (campo ownerJid / number). Retorna só os dígitos, ou null se não houver
 * número conectado ainda (instância criada mas QR não escaneado).
 */
export async function evolutionGetInstanceNumber(
  instanceName: string,
): Promise<string | null> {
  const { baseUrl, apiKey } = await getConfig();
  try {
    const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
      headers: headers(apiKey),
    });
    if (!res.ok) return null;
    const list: any[] = await res.json();
    const found = list.find(
      (i: any) => i.name === instanceName || i.instanceName === instanceName,
    );
    const raw: string | undefined =
      found?.ownerJid ?? found?.owner ?? found?.number ?? undefined;
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, "");
    return digits || null;
  } catch {
    return null;
  }
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
        // base64:false — NÃO baixar+codificar a mídia inline no webhook. Isso
        // evita o pico de memória na Evolution (mídia grande = base64 gigante
        // no processo, derrubando sockets de outras instâncias). A mídia é
        // buscada sob demanda via evolutionGetMediaBase64 quando a UI renderiza.
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution create: ${res.status} ${err}`);
  }
  return res.json();
}

/**
 * Baixa a mídia de uma mensagem sob demanda (POST /chat/getBase64FromMediaMessage).
 * Usado quando o webhook veio SEM base64 inline (base64:false) — a UI pede o
 * binário só quando vai renderizar. Retorna { base64 (puro), mimetype } ou null
 * (se a Evolution não conseguir rebaixar a mídia; a UI mostra placeholder).
 */
export async function evolutionGetMediaBase64(
  instanceName: string,
  key: { id: string; remoteJid: string; fromMe: boolean; participant?: string | null },
  instanceToken?: string | null,
  // data do webhook original (rawPayload.data) — contém key + message com
  // mediaKey/directPath/url, que a Evolution precisa pra DESCRIPTOGRAFAR a
  // mídia. Sem isso ela depende do próprio store, que às vezes já purgou →
  // "imagem não aparece". Com o payload completo, a taxa de sucesso sobe muito.
  rawData?: any,
): Promise<{ base64: string; mimetype: string | null } | null> {
  const { baseUrl, apiKey } = await getConfig();
  const token = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;

  // Payload preferencial: a mensagem completa do webhook (key + message).
  // Fallback: só a key (Evolution resolve pelo store interno, quando ainda tem).
  const messagePayload =
    rawData && rawData.key && rawData.message
      ? { key: rawData.key, message: rawData.message }
      : {
          key: {
            id: key.id,
            remoteJid: key.remoteJid,
            fromMe: key.fromMe,
            ...(key.participant ? { participant: key.participant } : {}),
          },
        };

  try {
    const res = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ message: messagePayload, convertToMp4: false }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[Evolution media] ${instanceName} ${res.status}: ${err.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const base64: string | null = data?.base64 ?? data?.media ?? null;
    const mimetype: string | null = data?.mimetype ?? data?.mediaType ?? null;
    if (!base64) return null;
    return { base64: String(base64).replace(/^data:[^;]+;base64,/, ""), mimetype };
  } catch {
    return null;
  }
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

/**
 * Atualiza configurações de comportamento da instância na Evolution
 * (POST /settings/set/{instance}). Equivale ao painel "Configurations →
 * Settings" no Manager — `groupsIgnore`, `rejectCall`, `alwaysOnline`, etc.
 *
 * IMPORTANTE: Evolution v2 NÃO aceita atualização parcial — o POST exige
 * todos os campos. Fazemos GET /settings/find/{instance} primeiro pra pegar
 * o estado atual e fazer merge com o override; assim trocar `groupsIgnore`
 * sozinho não zera os outros toggles que o admin configurou direto no Manager.
 *
 * Se a Evolution não conseguir devolver os settings atuais (instância nova
 * sem config), assumimos defaults seguros (todos false, msgCall vazio).
 */
export async function evolutionSetSettings(
  instanceName: string,
  override: {
    rejectCall?:      boolean;
    msgCall?:         string;
    groupsIgnore?:    boolean;
    alwaysOnline?:    boolean;
    readMessages?:    boolean;
    readStatus?:      boolean;
    syncFullHistory?: boolean;
  },
  instanceToken?: string | null,
) {
  const { baseUrl, apiKey } = await getConfig();
  const token = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;

  // 1. Pega config atual pra preservar campos não-tocados.
  let current: Record<string, unknown> = {};
  try {
    const findRes = await fetch(`${baseUrl}/settings/find/${instanceName}`, {
      headers: headers(token),
    });
    if (findRes.ok) {
      current = (await findRes.json()) ?? {};
    }
  } catch {
    // Sem config existente — segue com defaults
  }

  // 2. Merge: defaults seguros < estado atual < override do caller.
  const fullSettings = {
    rejectCall:      false,
    msgCall:         "",
    groupsIgnore:    false,
    alwaysOnline:    false,
    readMessages:    false,
    readStatus:      false,
    syncFullHistory: false,
    ...current,
    ...override,
  };

  // 3. POST com payload completo.
  const res = await fetch(`${baseUrl}/settings/set/${instanceName}`, {
    method:  "POST",
    headers: headers(token),
    body:    JSON.stringify(fullSettings),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution set settings: ${res.status} ${err}`);
  }
  return res.json();
}

/** Atualiza os eventos do webhook de uma instância existente */
export async function evolutionSetWebhookEvents(instanceName: string, webhookUrl: string, instanceToken?: string | null) {
  const { baseUrl, apiKey } = await getConfig();
  // Evolution API v2: webhook/set exige token da instância
  const token = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;
  const res = await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        // base64:false — mídia buscada sob demanda (ver evolutionGetMediaBase64).
        // Evita o pico de memória da Evolution ao codificar mídia grande inline.
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Evolution set webhook: ${res.status} ${err}`);
  }
  return res.json();
}

/** Envia mensagem de texto (com citação opcional) */
export async function evolutionSendText(
  instanceName: string,
  phone: string,
  text: string,
  instanceToken?: string | null,
  quoted?: { externalId: string; body: string; fromMe: boolean } | null,
  // Menções em grupo — array de números (só dígitos, ex: "5544999998888").
  // O texto deve conter o token `@<numero>` pra o WhatsApp renderizar o
  // destaque; aqui montamos o array de JIDs que a Evolution v2 espera.
  mentioned?: string[] | null
) {
  const { baseUrl, apiKey } = await getConfig();

  // No v2, endpoints de instância exigem o token da instância
  const authKey = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;

  // Para grupos: preservar o JID completo; para individuais: só dígitos
  const number = phone.includes("@g.us") ? phone : phone.replace(/\D/g, "");

  const body: Record<string, unknown> = { number, text };

  // Menções (só em grupo). Recebe JIDs completos — mantém @lid (identidade
  // anonimizada do WhatsApp Business, hoje o identificador válido) e normaliza
  // número puro pra @s.whatsapp.net. O texto deve conter o token @<numero>.
  // OBS: formato pode variar por versão da Evolution — validar com envio real.
  if (mentioned && mentioned.length > 0) {
    body.mentioned = mentioned
      .map((n) => {
        if (!n) return "";
        if (n.includes("@")) return n;                 // já é JID (@lid / @s.whatsapp.net)
        const digits = n.replace(/\D/g, "");
        return digits ? `${digits}@s.whatsapp.net` : "";
      })
      .filter(Boolean);
  }

  // Adicionar citação se fornecida
  if (quoted) {
    body.quoted = {
      key: {
        remoteJid: phone.includes("@g.us") ? phone : `${number}@s.whatsapp.net`,
        fromMe: quoted.fromMe,
        id: quoted.externalId,
      },
      message: { conversation: quoted.body },
    };
  }

  // "Connection Closed": o socket do Baileys estava reconectando no momento do
  // envio. É TRANSITÓRIO e a mensagem NÃO foi enviada (erro antes de sair), então
  // é seguro repetir sem risco de duplicar. Baileys costuma reconectar em poucos
  // segundos — tenta de novo com uma pequena espera antes de desistir.
  const doPost = () => fetch(`${baseUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: headers(authKey),
    body: JSON.stringify(body),
  });

  let res = await doPost();
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !res.ok; attempt++) {
    lastErr = await res.text();
    if (!(res.status === 400 && /connection closed/i.test(lastErr))) break; // só re-tenta o caso transitório
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));          // 1.5s, depois 3s
    res = await doPost();
  }

  if (!res.ok) {
    const err = res.bodyUsed ? lastErr : await res.text();
    throw new Error(`Evolution send: ${res.status} ${err}`);
  }
  return res.json();
}

/** Envia mídia (imagem, vídeo, documento) — base64 OU URL */
export async function evolutionSendMedia(
  instanceName: string,
  phone: string,
  args: {
    /** base64 puro (sem o prefixo `data:image/...;base64,`) ou URL pública */
    media: string;
    /** "image" | "video" | "document". Áudio tem endpoint próprio (sendWhatsAppAudio). */
    mediatype: "image" | "video" | "document";
    /** MIME real do arquivo, ex: "image/jpeg" */
    mimetype: string;
    /** Legenda opcional (aparece junto da imagem no WhatsApp) */
    caption?: string | null;
    /** Nome do arquivo (só usado pra mediatype="document") */
    fileName?: string | null;
  },
  instanceToken?: string | null,
  quoted?: { externalId: string; body: string; fromMe: boolean } | null
) {
  const { baseUrl, apiKey } = await getConfig();
  const authKey = instanceToken ?? (await evolutionGetInstanceToken(instanceName)) ?? apiKey;
  const number = phone.includes("@g.us") ? phone : phone.replace(/\D/g, "");

  // Evolution aceita base64 puro no campo `media`. Se vier com prefixo data:..., remove.
  const media = args.media.replace(/^data:[^;]+;base64,/, "");

  const body: Record<string, unknown> = {
    number,
    mediatype: args.mediatype,
    mimetype: args.mimetype,
    media,
  };
  if (args.caption) body.caption = args.caption;
  if (args.fileName) body.fileName = args.fileName;
  if (quoted) {
    body.quoted = {
      key: {
        remoteJid: phone.includes("@g.us") ? phone : `${number}@s.whatsapp.net`,
        fromMe: quoted.fromMe,
        id: quoted.externalId,
      },
      message: { conversation: quoted.body },
    };
  }

  // Mesmo tratamento do sendText: "Connection Closed" é transitório e a mídia
  // não foi enviada — retry único com espera antes de desistir.
  const doPost = () => fetch(`${baseUrl}/message/sendMedia/${instanceName}`, {
    method: "POST",
    headers: headers(authKey),
    body: JSON.stringify(body),
  });

  let res = await doPost();
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !res.ok; attempt++) {
    lastErr = await res.text();
    if (!(res.status === 400 && /connection closed/i.test(lastErr))) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    res = await doPost();
  }
  if (!res.ok) {
    const err = res.bodyUsed ? lastErr : await res.text();
    throw new Error(`Evolution sendMedia: ${res.status} ${err}`);
  }
  return res.json();
}

/** Busca o nome (subject) de um grupo pelo JID */
export async function evolutionGetGroupName(instanceName: string, groupJid: string, instanceToken?: string | null): Promise<string | null> {
  try {
    const { baseUrl, apiKey } = await getConfig();
    const authKey = instanceToken ?? await evolutionGetInstanceToken(instanceName) ?? apiKey;
    const res = await fetch(
      `${baseUrl}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      { headers: headers(authKey) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Evolution pode retornar array ou objeto direto
    const info = Array.isArray(data) ? data[0] : data;
    return info?.subject ?? info?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Valida quais números da lista possuem WhatsApp ativo via Evolution
 * `/chat/whatsappNumbers/{instance}`. Retorna um Map<phone, boolean>:
 * - true  = WhatsApp ativo no número
 * - false = sem WhatsApp
 * Números que a Evolution não retornou no array de resposta caem em FALSE
 * (a Evolution só retorna os que existem; quando não retorna, é sinal de
 * que não tem). Falha graceful: se nenhuma instância passada ou erro de
 * rede, retorna Map vazio (caller decide o que fazer com null).
 */
export async function evolutionCheckWhatsappNumbers(
  instanceName: string,
  numbers: string[],
  instanceToken?: string | null
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const cleaned = Array.from(new Set(numbers.map((n) => n.replace(/\D/g, "")).filter((n) => n.length >= 8)));
  if (cleaned.length === 0) return result;

  try {
    const { baseUrl, apiKey } = await getConfig();
    const authKey = instanceToken ?? (await evolutionGetInstanceToken(instanceName)) ?? apiKey;

    const res = await fetch(`${baseUrl}/chat/whatsappNumbers/${instanceName}`, {
      method: "POST",
      headers: headers(authKey),
      body: JSON.stringify({ numbers: cleaned }),
    });
    if (!res.ok) {
      // Pré-popula tudo como false em caso de falha — não confiável
      // mas evita travar o fluxo. Caller decide se quer retry.
      for (const n of cleaned) result.set(n, false);
      return result;
    }
    const data: any = await res.json().catch(() => []);
    // Evolution retorna array de { exists, jid, number } ou similar.
    // O `number` pode vir com ou sem dígitos extras — comparamos por sufixo.
    const arr = Array.isArray(data) ? data : [];
    const existsSet = new Set<string>();
    for (const item of arr) {
      const exists = item?.exists === true || item?.status === "exists" || !!item?.jid;
      const num = String(item?.number ?? item?.jid ?? "").replace(/\D/g, "");
      if (exists && num) existsSet.add(num);
    }
    // Marca true se algum sufixo da resposta bate com o número enviado
    for (const n of cleaned) {
      const found =
        existsSet.has(n) ||
        Array.from(existsSet).some((e) => e.endsWith(n) || n.endsWith(e));
      result.set(n, found);
    }
    return result;
  } catch {
    return result; // vazio = "não foi possível validar"
  }
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

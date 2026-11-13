/**
 * Cache curto em memória pra leituras repetidas a cada requisição (sessão,
 * plano da empresa). O app roda em UM container, então memória do processo
 * basta — não é cache distribuído nem fonte da verdade.
 *
 * - Guarda a Promise: requisições simultâneas pela mesma chave dividem uma
 *   consulta só, em vez de cada uma ir ao banco.
 * - Erro não fica em cache: a próxima chamada tenta de novo.
 * - Vive em globalThis pra sobreviver ao hot reload do dev.
 */
const stores: Map<string, Map<string, unknown>> = ((globalThis as any).__ttlCacheStores ??= new Map());

/**
 * Esvazia todos os caches. Chame depois de gravar algo que muda acesso (plano,
 * exceção de módulo, add-on, setor) pra a mudança valer na requisição seguinte.
 */
export function clearAllTtlCaches() {
  for (const s of stores.values()) s.clear();
}

export function ttlCache<T>(name: string, ttlMs: number, maxEntries = 5000) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name) as Map<string, { at: number; value: Promise<T> }>;

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      if (store.size >= maxEntries) store.clear();
      const value = load();
      store.set(key, { at: now, value });
      value.catch(() => {
        if (store.get(key)?.value === value) store.delete(key);
      });
      return value;
    },
    delete(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

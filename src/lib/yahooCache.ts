type CacheEntry<T> = { expires: number; value: T };

const store = new Map<string, CacheEntry<unknown>>();

export async function cachedYahooJson<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const value = await fetcher();
  store.set(key, { expires: now + ttlMs, value });
  return value;
}

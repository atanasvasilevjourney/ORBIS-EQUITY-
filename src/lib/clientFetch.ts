/** Browser fetch with timeout — avoids infinite loading spinners on slow API routes. */

export type FetchJsonOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
  opts?: FetchJsonOptions
): Promise<{ ok: boolean; status: number; data: T | null; timedOut: boolean }> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort);

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    const data = (await res.json()) as T;
    return { ok: res.ok, status: res.status, data, timedOut: false };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return { ok: false, status: timedOut ? 408 : 0, data: null, timedOut };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
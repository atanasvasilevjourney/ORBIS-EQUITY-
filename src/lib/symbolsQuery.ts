const MAX_SYMBOLS = 50;

export function parseSymbolsQueryParam(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase().replace(/^\$/, "");
    if (!s || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

/** Dedicated CHART module path. PLAY / ⌘K open this instead of a side pane. */

export type ChartTf = "1d" | "5m";

export function chartHref(
  ticker: string,
  opts?: { tf?: ChartTf; from?: string }
): string {
  const t = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!t) return "/chart";
  const q = new URLSearchParams();
  if (opts?.tf === "1d" || opts?.tf === "5m") q.set("tf", opts.tf);
  if (opts?.from) q.set("from", opts.from);
  const qs = q.toString();
  return qs ? `/chart/${encodeURIComponent(t)}?${qs}` : `/chart/${encodeURIComponent(t)}`;
}

export function playScanTimeframe(scan: string): ChartTf {
  if (scan === "overnight" || scan === "breakout5m") return "5m";
  return "1d";
}

/** Honest tape line for CHART / BIAS / ticker strips. */
export function chartSourceNote(
  interval: string | undefined,
  source: string | undefined,
  opts?: { overlayOk?: boolean; levels?: boolean }
): string {
  const overlayOk = opts?.overlayOk ?? true;
  const levels = opts?.levels ?? false;
  const src = String(source || "").toLowerCase();
  if (interval === "5m") {
    const tape = src.startsWith("lse") ? "LSE vault 5m" : "Yahoo delayed 5m";
    if (levels && !overlayOk) return ` · ${tape} · EOD levels hidden (price disagree)`;
    if (levels) return ` · ${tape}, levels from EOD book`;
    return ` · ${tape}`;
  }
  if (interval === "1d") return " · EOD / closed bars";
  return "";
}

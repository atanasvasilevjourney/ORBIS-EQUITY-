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

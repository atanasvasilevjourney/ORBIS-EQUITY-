export type Ema200Timeframe = "daily" | "weekly";

export function parseEma200Timeframe(raw: string | null | undefined): Ema200Timeframe {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "weekly" || v === "1w" || v === "w" ? "weekly" : "daily";
}

export const EMA200_TF_STORAGE_KEY = "orbis-ema200-tf";

export function ema200TimeframeLabel(tf: Ema200Timeframe): string {
  return tf === "weekly" ? "Weekly" : "Daily";
}

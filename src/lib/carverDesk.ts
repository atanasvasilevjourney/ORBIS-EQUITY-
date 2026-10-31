/** Carver sizing rules shared by the cash book and the rotation D-rungs. */

export const RUNG_EDGES = [5, 10, 15, 20] as const;
export const FORECAST_CAP = 20;
export const FORECAST_MIN = 5;

export function rungsFromForecast(forecast: number | null): number {
  if (forecast == null || !Number.isFinite(forecast)) return 0;
  const magnitude = Math.abs(forecast);
  return RUNG_EDGES.filter((edge) => magnitude + 1e-12 >= edge).length;
}

export function forecastTone(forecast: number | null): "bull" | "bear" | "flat" {
  if (forecast == null || !Number.isFinite(forecast) || Math.abs(forecast) < FORECAST_MIN) return "flat";
  return forecast > 0 ? "bull" : "bear";
}

/** 0–100 width of |forecast| against the ±20 cap. */
export function forecastFill(forecast: number | null): number {
  if (forecast == null || !Number.isFinite(forecast) || forecast === 0) return 0;
  return Math.max(6, Math.min(100, (Math.abs(forecast) / FORECAST_CAP) * 100));
}

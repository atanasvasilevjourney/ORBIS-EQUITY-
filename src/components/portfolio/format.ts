export function pct(n: number, digits = 1, signed = true): string {
  if (!Number.isFinite(n)) return "—";
  const v = n * 100;
  const body = `${Math.abs(v).toFixed(digits)}%`;
  if (!signed) return `${v < 0 ? "-" : ""}${body}`;
  if (v > 0.0005) return `+${body}`;
  if (v < -0.0005) return `-${body}`;
  return `${Math.abs(v).toFixed(digits)}%`;
}

export function pts(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

export function usd(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return "—";
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  }).format(n);
}

export function num(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function tone(n: number): string {
  if (n > 0.0000001) return "text-[var(--accent-bull)]";
  if (n < -0.0000001) return "text-[var(--accent-bear)]";
  return "text-[var(--text-primary)]";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}

export function monthLetter(i: number): string {
  return ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i] ?? "";
}

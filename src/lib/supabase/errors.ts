/** PostgREST / Postgres errors that mean "this object is not in the hosted schema". */

export function errorText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const rec = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return [rec.code, rec.message, rec.details, rec.hint].filter(Boolean).join(" ");
  }
  return String(err);
}

export function isMissingRelation(err: unknown): boolean {
  const rec = err && typeof err === "object" ? (err as { code?: string }) : null;
  const code = rec?.code ?? "";
  if (code === "PGRST205" || code === "42P01") return true;
  const text = errorText(err);
  if (/column /i.test(text)) return false;
  return /could not find the table|schema cache|relation .+ does not exist/i.test(text);
}

export function isMissingColumn(err: unknown): boolean {
  const rec = err && typeof err === "object" ? (err as { code?: string }) : null;
  const code = rec?.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  return /column .* does not exist/i.test(errorText(err));
}

export function isIgnorableReadError(err: unknown): boolean {
  const rec = err && typeof err === "object" ? (err as { code?: string }) : null;
  if (rec?.code === "PGRST116") return true; // .single() not found
  return isMissingRelation(err);
}

/** Avoid blank GICS sector labels in API rows. */

export function displaySector(meta: {
  sector?: string | null;
  industry?: string | null;
}): string {
  const sector = (meta.sector ?? "").trim();
  if (sector) return sector;
  const industry = (meta.industry ?? "").trim();
  if (!industry) return "Unclassified";
  const head = industry
    .split(/[,\/]/)
    .map((part) => part.trim())
    .filter(Boolean)[0];
  return head || "Unclassified";
}
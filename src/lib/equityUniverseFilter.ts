/** Client/API mirror of pipeline.universe_filters research-desk rules. */

const STRUCTURED_SUFFIX =
  /^(?:[A-Z]{1,5}[-.])?[A-Z]{2,6}(?:U|W|R|WS|WT|UW|AW|BW|WW)$/;

const SPAC_NAME_HINTS = [
  " acquisition ",
  " blank check ",
  " spac ",
  " special purpose ",
  " warrant ",
  " unit ",
  " rights ",
];

export function isStructuredProductSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase().trim();
  if (!s || s.length < 3) return true;
  if (s.includes("+") || s.includes("^")) return true;
  if (s.includes(".") && !s.endsWith(".A") && !s.endsWith(".B")) return true;
  return STRUCTURED_SUFFIX.test(s);
}

export function isSpacShellName(companyName: string | null | undefined): boolean {
  const name = ` ${(companyName ?? "").toLowerCase()} `;
  return SPAC_NAME_HINTS.some((h) => name.includes(h));
}

export type UniverseMemberLite = {
  symbol: string;
  tier?: string | null;
  is_active?: boolean | null;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
};

function isPharma(row: UniverseMemberLite): boolean {
  const industry = (row.industry ?? "").toLowerCase();
  const sector = (row.sector ?? "").toLowerCase();
  if (["pharmaceutical", "biotechnology", "drug manufacturer"].some((k) => industry.includes(k))) {
    return true;
  }
  return sector === "pharmaceuticals" || sector === "biotechnology";
}

export function isResearchDeskEligible(row: UniverseMemberLite): boolean {
  if (row.is_active === false) return false;
  const sym = row.symbol ?? "";
  if (isStructuredProductSymbol(sym)) return false;
  if (isSpacShellName(row.company_name)) return false;
  const tier = row.tier ?? "";
  if (tier !== "us_large" && tier !== "us_nasdaq100") return false;
  return !isPharma(row);
}

export function filterResearchDeskRows<T extends { symbol: string }>(
  rows: T[],
  eligible: Set<string>
): T[] {
  return rows.filter((r) => eligible.has(r.symbol));
}
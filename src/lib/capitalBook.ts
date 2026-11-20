/** Combined paper notional across sleeves that each assume their own $100k. */

export type SleeveName = "LOOP" | "ORB" | "CASH" | "ROTATE";

/** Which short-term book a leg came from. Cash TEMA and Cash Carver stay separate. */
export type CapitalBookTag = "loop" | "orb" | "tema" | "carver" | "rotate";

export type CapitalLeg = {
  sleeve: SleeveName;
  symbol: string;
  signedNotional: number;
  asOf: string | null;
  book?: CapitalBookTag;
  unrealizedPnlUsd?: number | null;
  daysHeld?: number | null;
};

export type SleeveCapital = {
  sleeve: SleeveName;
  gross: number;
  net: number;
  asOf: string | null;
  names: number;
};

export type CapitalBook = {
  gross: number;
  net: number;
  overlap: string[];
  sleeves: SleeveCapital[];
};

const SLEEVES: SleeveName[] = ["LOOP", "ORB", "CASH", "ROTATE"];

export function signedNotional(side: string | null | undefined, amount: number | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount === 0) return null;
  const s = (side ?? "").toUpperCase();
  if (s === "SHORT" || s === "SELL") return -Math.abs(amount);
  if (s === "LONG" || s === "BUY") return Math.abs(amount);
  return null;
}

export function combineCapital(legs: CapitalLeg[]): CapitalBook {
  const sleeves: SleeveCapital[] = SLEEVES.map((sleeve) => {
    const rows = legs.filter((leg) => leg.sleeve === sleeve && leg.signedNotional !== 0);
    const names = new Set(rows.map((leg) => leg.symbol));
    const asOf = rows.map((leg) => leg.asOf).filter((d): d is string => !!d).sort().at(-1) ?? null;
    return {
      sleeve,
      gross: rows.reduce((sum, leg) => sum + Math.abs(leg.signedNotional), 0),
      net: rows.reduce((sum, leg) => sum + leg.signedNotional, 0),
      asOf,
      names: names.size,
    };
  });

  const bySymbol = new Map<string, Set<SleeveName>>();
  for (const leg of legs) {
    if (!leg.symbol || leg.signedNotional === 0) continue;
    const set = bySymbol.get(leg.symbol) ?? new Set<SleeveName>();
    set.add(leg.sleeve);
    bySymbol.set(leg.symbol, set);
  }
  const overlap = Array.from(bySymbol.entries())
    .filter(([, set]) => set.size > 1)
    .map(([symbol]) => symbol)
    .sort();

  return {
    gross: sleeves.reduce((sum, sleeve) => sum + sleeve.gross, 0),
    net: sleeves.reduce((sum, sleeve) => sum + sleeve.net, 0),
    overlap,
    sleeves,
  };
}

type LoopRow = {
  symbol: string;
  side: string | null;
  shares: number | null;
  last: number | null;
  unrealizedPnlUsd?: number | null;
  daysHeld?: number | null;
};
type OrbRow = {
  symbol: string;
  status: string | null;
  shares: number | null;
  last: number | null;
  entry: number | null;
};
type CashRow = {
  symbol: string;
  inTema: boolean;
  temaSide: string | null;
  temaNotional: number | null;
  inCarver: boolean;
  carverSide: string | null;
  carverNotional: number | null;
};
type RotateRow = { symbol: string; side: string | null; notional: number | null };

export function legsFromBooks(input: {
  loopAsOf: string | null;
  loop: LoopRow[];
  orbAsOf: string | null;
  orb: OrbRow[];
  cashAsOf: string | null;
  cash: CashRow[];
  rotateAsOf: string | null;
  rotate: RotateRow[];
}): CapitalLeg[] {
  const legs: CapitalLeg[] = [];

  for (const row of input.loop) {
    if (row.shares == null || row.last == null) continue;
    const signed = signedNotional(row.side, row.shares * row.last);
    if (signed == null) continue;
    legs.push({
      sleeve: "LOOP",
      symbol: row.symbol,
      signedNotional: signed,
      asOf: input.loopAsOf,
      book: "loop",
      unrealizedPnlUsd: row.unrealizedPnlUsd ?? null,
      daysHeld: row.daysHeld ?? null,
    });
  }

  for (const row of input.orb) {
    if (row.status !== "BREAKOUT" || row.shares == null) continue;
    const px = row.last ?? row.entry;
    if (px == null) continue;
    const signed = signedNotional("LONG", row.shares * px);
    if (signed == null) continue;
    const pnl = row.entry != null && Number.isFinite(row.entry) ? (px - row.entry) * row.shares : null;
    legs.push({
      sleeve: "ORB",
      symbol: row.symbol,
      signedNotional: signed,
      asOf: input.orbAsOf,
      book: "orb",
      unrealizedPnlUsd: pnl,
      daysHeld: null,
    });
  }

  for (const row of input.cash) {
    if (row.inTema) {
      const signed = signedNotional(row.temaSide, row.temaNotional);
      if (signed != null) {
        legs.push({
          sleeve: "CASH",
          symbol: row.symbol,
          signedNotional: signed,
          asOf: input.cashAsOf,
          book: "tema",
          unrealizedPnlUsd: null,
          daysHeld: null,
        });
      }
    }
    if (row.inCarver) {
      const signed = signedNotional(row.carverSide, row.carverNotional);
      if (signed != null) {
        legs.push({
          sleeve: "CASH",
          symbol: row.symbol,
          signedNotional: signed,
          asOf: input.cashAsOf,
          book: "carver",
          unrealizedPnlUsd: null,
          daysHeld: null,
        });
      }
    }
  }

  for (const row of input.rotate) {
    const signed = signedNotional(row.side, row.notional);
    if (signed == null) continue;
    legs.push({
      sleeve: "ROTATE",
      symbol: row.symbol,
      signedNotional: signed,
      asOf: input.rotateAsOf,
      book: "rotate",
      unrealizedPnlUsd: null,
      daysHeld: null,
    });
  }

  return legs;
}

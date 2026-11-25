import { refreshFundamentalQuotes } from "@/lib/fundamentalsSanity";
import { optionsFlowProxy, type SessionQuote } from "@/lib/sessionQuotes";

type FundSnap = {
  price: number | null;
  market_cap: number | null;
  pe_ratio?: number | null;
  dividend_yield?: number | null;
  composite_factor_score?: number | null;
};

type RadarSnap = {
  symbol: string;
  state: number;
  quality_rank: number;
  z_mom: number;
  f_ewmac: number;
  z_52: number;
  breakout_active: boolean;
  volume_confirmed: boolean;
  kama_regime?: number | null;
  adx?: number | null;
  entry_timing?: string | null;
  convergence_count: number;
  state_changed_at: string | null;
};

type UniverseSnap = {
  company_name: string | null;
  sector: string | null;
  country: string | null;
  exchange: string | null;
  tier: string | null;
};

export function buildScreenerRow(
  r: RadarSnap,
  u: UniverseSnap,
  f: FundSnap | undefined,
  quote: SessionQuote | undefined,
  extras: {
    orbisScore: number | null;
    signalSource: string;
    strategyAsOf: string | null;
    hasTrendRadar: boolean;
  }
) {
  const refreshed = refreshFundamentalQuotes({
    snapshotPrice: f?.price ?? null,
    snapshotMarketCap: f?.market_cap ?? null,
    livePrice: quote?.last ?? null,
    quoteAsOf: quote?.asOf ?? null,
    quoteStale: quote?.stale ?? true,
  });
  const flow = optionsFlowProxy(quote);
  const dayFromTape = quote?.dayPct ?? null;

  return {
    symbol: r.symbol,
    companyName: u.company_name ?? "",
    sector: u.sector ?? "",
    country: u.country ?? "",
    exchange: u.exchange ?? "",
    tier: u.tier ?? "",
    state: r.state,
    rank: r.quality_rank,
    zMom: r.z_mom,
    fEwmac: r.f_ewmac,
    z52: r.z_52,
    breakout: r.breakout_active,
    volumeConfirmed: r.volume_confirmed,
    kamaRegime: r.kama_regime ?? 0,
    adx: r.adx ?? null,
    entryTiming: r.entry_timing ?? null,
    convergence: r.convergence_count,
    stateChangedAt: r.state_changed_at,
    dayPct: dayFromTape ?? r.z_mom,
    dayPctSource: dayFromTape != null ? ("session_close" as const) : ("trend_radar" as const),
    relVolume: r.f_ewmac,
    relVolumeNote: "Relative share volume (today vs 50d average), not options flow.",
    pctFromHigh: r.z_52 * 100,
    price: refreshed.price,
    priceAsOf: refreshed.priceAsOf,
    quoteStale: refreshed.quoteStale,
    snapshotPrice: refreshed.snapshotPrice,
    marketCap: refreshed.marketCap,
    snapshotMarketCap: refreshed.snapshotMarketCap,
    marketCapImpliedFromPrice: refreshed.marketCapImpliedFromPrice,
    peRatio: f?.pe_ratio ?? null,
    divYield: f?.dividend_yield ?? null,
    orbisScore: extras.orbisScore,
    compositeScore: f?.composite_factor_score ?? null,
    optionsFlowProxy: flow,
    hasTrendRadar: extras.hasTrendRadar,
    signalSource: extras.signalSource,
    strategyAsOf: extras.strategyAsOf,
  };
}
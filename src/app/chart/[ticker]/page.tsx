"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TradingChart, type Candle } from "@/components/chart/TradingChart";
import { chartHref } from "@/lib/chartDesk";
import { recordRecentTicker, recentTickers } from "@/components/command/CommandPalette";

type ChartTf = "1d" | "5m";

type ChartPayload = {
  ticker?: string;
  interval?: string;
  source?: string;
  candles?: Candle[];
  sma20?: (number | null)[];
};

type Quote = { last: number; bid: number | null; ask: number | null };

function asTf(v: string | null): ChartTf {
  return v === "5m" ? "5m" : "1d";
}

export default function ChartTickerPage() {
  const params = useParams<{ ticker: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const ticker = String(params?.ticker || "").trim().toUpperCase();
  const from = search.get("from");
  const [tf, setTf] = useState<ChartTf>(() => asTf(search.get("tf")));
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTf(asTf(search.get("tf")));
  }, [search]);

  useEffect(() => {
    if (!ticker) return;
    recordRecentTicker(ticker);
    const ac = new AbortController();
    setPayload(null);
    setErr(null);
    fetch(`/api/chart/${encodeURIComponent(ticker)}?interval=${tf}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("chart");
        return r.json();
      })
      .then((body: ChartPayload) => setPayload(body))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setErr("Chart unavailable");
        setPayload(null);
      });
    fetch(`/api/quotes?symbols=${encodeURIComponent(ticker)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((body) => {
        const row = Array.isArray(body?.quotes) ? body.quotes[0] : null;
        const last = Number(row?.last);
        if (!(last > 0)) return;
        setQuote({
          last,
          bid: row.bid == null ? null : Number(row.bid),
          ask: row.ask == null ? null : Number(row.ask),
        });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [ticker, tf]);

  const candles = payload?.candles ?? [];
  const lastClose = candles.length ? candles[candles.length - 1].close : quote?.last ?? null;
  const source = payload?.source ?? "…";
  const interval = payload?.interval ?? tf;
  const fromPlay = from === "play";
  const recents = useMemo(() => recentTickers().filter((t) => t !== ticker).slice(0, 6), [ticker, payload]);

  function pickTf(next: ChartTf) {
    setTf(next);
    router.replace(chartHref(ticker, { tf: next, from: fromPlay ? "play" : undefined }));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 px-3 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-x-4 gap-y-1 bg-[var(--surface)]">
        <div>
          <h1 className="text-sm font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
            CHART · {ticker || "—"}
          </h1>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal">
            Full pane · wheel zooms · drag pans · not TOS Level-1
          </p>
        </div>
        <div className="text-[10px] font-terminal text-[var(--text-secondary)]">
          {ticker} · {interval} · {source}
          {interval === "5m"
            ? source === "lse"
              ? " · LSE vault"
              : " · Yahoo 5m"
            : " · prices_daily"}
        </div>
        <div className="flex gap-1">
          {(["1d", "5m"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickTf(k)}
              className={`px-2 py-0.5 text-[10px] font-terminal rounded border ${
                tf === k
                  ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                  : "border-[var(--border)] text-[var(--text-muted)]"
              }`}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
        {lastClose != null ? (
          <div className="text-sm font-terminal font-bold">{lastClose.toFixed(lastClose >= 100 ? 2 : 3)}</div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[10px] font-terminal">
          {fromPlay ? (
            <Link href="/play" className="text-[var(--accent-warning)] hover:underline">
              ← PLAY
            </Link>
          ) : (
            <Link href="/play" className="text-[var(--text-muted)] hover:text-[var(--accent-info)]">
              PLAY
            </Link>
          )}
          <Link href={`/ticker/${ticker}`} className="text-[var(--text-muted)] hover:text-[var(--accent-info)]">
            DOSSIER
          </Link>
          <Link href="/bias" className="text-[var(--text-muted)] hover:text-[var(--accent-info)]">
            BIAS
          </Link>
          {recents.map((t) => (
            <Link key={t} href={chartHref(t, { tf })} className="text-[var(--text-muted)] hover:text-[var(--accent-info)]">
              {t}
            </Link>
          ))}
        </div>
      </header>
      <div className="flex-1 min-h-0 bg-[var(--card-bg)]">
        {err ? (
          <div className="h-full flex items-center justify-center text-xs font-terminal text-[var(--text-muted)]">
            {err}
          </div>
        ) : (
          <TradingChart candles={candles} sma={interval === "1d" ? payload?.sma20 : undefined} levels={[]} />
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { DeskWidget } from "@/components/ui/DeskWidget";
import { FORECAST_CAP, FORECAST_MIN, RUNG_EDGES, forecastFill, forecastTone, rungsFromForecast } from "@/lib/carverDesk";
import { barShare, formatPx } from "@/lib/rotationDesk";

export type CarverCard = {
  ticker: string;
  name?: string | null;
  last?: number | null;
  forecast: number | null;
  parentForecast?: number | null;
  side?: string | null;
  action?: string | null;
  notional?: number | null;
  weight?: number | null;
  rungs?: number | null;
  fast?: number | null;
  slow?: number | null;
};

const ACCENTS = ["var(--dot-amzn)", "var(--dot-googl)", "var(--dot-meta)", "var(--dot-msft)"];

function toneColor(tone: ReturnType<typeof forecastTone>): string {
  if (tone === "bull") return "var(--accent-bull)";
  if (tone === "bear") return "var(--accent-bear)";
  return "var(--text-muted)";
}

function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function Rungs({ lit }: { lit: number }) {
  return (
    <div className="mt-1.5 flex gap-1" aria-label={`${lit} of 4 rungs`}>
      {RUNG_EDGES.map((edge, index) => (
        <span key={edge} className="h-1.5 flex-1 rounded-full" style={{ background: index < lit ? "var(--accent-bull)" : "var(--track)" }} title={`D${index + 1} at |forecast| ${edge}`} />
      ))}
    </div>
  );
}

export function CarverBoard({
  mode,
  rows,
  onPick,
}: {
  mode: "cash" | "dca";
  rows: CarverCard[];
  onPick?: (ticker: string) => void;
}) {
  const cash = mode === "cash";
  const usable = rows.filter((row) => row.ticker);
  const allocated = usable.filter((row) => (row.rungs ?? 0) > 0 || Math.abs(row.notional ?? 0) > 0);
  const ranked = (cash ? usable : allocated)
    .sort((a, b) => Math.abs(b.notional ?? 0) - Math.abs(a.notional ?? 0) || Math.abs(b.forecast ?? 0) - Math.abs(a.forecast ?? 0))
    .slice(0, 4);
  const peers = ranked.map((row) => row.notional ?? null);

  return (
    <DeskWidget
      title={cash ? "Carver cash book" : "Carver D-rungs"}
      className="mb-6"
      status={cash ? "Fully funded paper shares" : "Paper sleeve, isolated from cash"}
      menu={[{ href: cash ? "/rotate#carver" : "/cash", label: cash ? "Rotation rungs" : "Cash Carver book" }]}
      footer={
        cash ? (
          <>
            <span>EWMAC 16/64 + 32/128 · clip ±{FORECAST_CAP}</span>
            <span>|f| ≥ {FORECAST_MIN} · vol target 25% · IDM 1.2 · no leverage</span>
          </>
        ) : (
          <>
            <span>Parent forecast unlocks D1–D4 at 5 / 10 / 15 / 20</span>
            <span>Leading sleeve only · name must agree · 20% cap</span>
          </>
        )
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        {cash ? (
          <>
            <Step n="1" text="Average the 16/64 and 32/128 forecasts. Clip at ±20." />
            <Step n="2" text="Drop the name when |forecast| is under 5." />
            <Step n="3" text="Weight = (f / 10) × 1.2 × (25% / vol) × drawdown scalar." />
            <Step n="4" text="Buy or short that many dollars of the listed close." />
          </>
        ) : (
          <>
            <Step n="1" text="The sector forecast is the bigger trend." />
            <Step n="2" text="Each rung turns on at |f| 5, 10, 15, 20." />
            <Step n="3" text="Rungs go to the leading sleeve and agreeing names." />
            <Step n="4" text="ADD is more size. ROTATE sends the rungs elsewhere." />
          </>
        )}
      </div>
      {ranked.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          {cash
            ? "No cash slots yet. A name joins after the blended forecast clears 5."
            : "No rungs are funded in this sleeve. A name can print a forecast of 20 and still stay flat until the sector forecast clears 5 and the name agrees."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ranked.map((row, index) => {
            const accent = ACCENTS[index % ACCENTS.length];
            const tone = forecastTone(row.forecast);
            const headline = cash ? row.forecast : (row.parentForecast ?? row.forecast);
            const lit = row.rungs ?? rungsFromForecast(headline);
            return (
              <Link
                key={row.ticker}
                href={`/ticker/${row.ticker}`}
                onClick={() => onPick?.(row.ticker)}
                className="quote-card block overflow-hidden px-4 py-3.5 hover:bg-[var(--surface-alt)]"
                style={{ boxShadow: `inset 0 2px 0 0 ${accent}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold tracking-wide" style={{ color: accent }}>
                      {row.ticker}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums" style={{ color: toneColor(cash ? tone : forecastTone(headline)) }}>
                        {headline == null ? "—" : headline.toFixed(1)}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">{row.side || row.action || "forecast"}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-semibold tabular-nums">{formatPx(row.last ?? null)}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{row.action || row.name || "paper"}</div>
                  </div>
                </div>
                <div className="mt-3 text-[10px] text-[var(--text-muted)]">
                  {cash ? `Forecast · cap ±${FORECAST_CAP}` : `D-rungs · parent ${row.parentForecast == null ? "—" : row.parentForecast.toFixed(1)}`}
                </div>
                {cash ? (
                  <div className="mag-track mt-1.5">
                    <div className="mag-fill" style={{ width: `${forecastFill(row.forecast)}%`, background: toneColor(tone) }} />
                  </div>
                ) : (
                  <Rungs lit={lit} />
                )}
                <div className="mt-3 flex items-baseline justify-between text-[10px] text-[var(--text-muted)]">
                  <span>{cash ? "Cash notional" : "Sleeve notional"}</span>
                  <span className="tabular-nums" style={{ color: (row.notional ?? 0) < 0 ? "var(--accent-bear)" : "var(--text-primary)" }}>
                    {usd(row.notional)}
                    {row.weight != null ? ` · ${(row.weight * 100).toFixed(1)}%` : ""}
                  </span>
                </div>
                <div className="mag-track mt-1.5">
                  <div
                    className="mag-fill"
                    style={{
                      width: `${barShare(row.notional ?? null, peers)}%`,
                      background: (row.notional ?? 0) < 0 ? "var(--accent-bear)" : accent,
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </DeskWidget>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-2">
      <div className="text-[10px] font-semibold text-[var(--text-muted)]">STEP {n}</div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}

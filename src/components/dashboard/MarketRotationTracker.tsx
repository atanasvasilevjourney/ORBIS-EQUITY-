"use client";

import Link from "next/link";
import { DeskWidget } from "@/components/ui/DeskWidget";
import {
  barScale,
  formatPx,
  indexSpread,
  latestDate,
  moveTone,
  ROTATION_INDEXES,
  sectorRank,
  sectorTag,
  signedPct,
  spreadCall,
  spreadMeter,
} from "@/lib/rotationDesk";

export type RotationQuote = {
  symbol: string;
  label: string;
  last: number | null;
  dayPct: number | null;
  asOf?: string | null;
};

export type RotationSector = {
  name: string;
  rs4w: number | null;
  score?: number | null;
};

const DOT: Record<string, string> = {
  QQQ: "var(--dot-qqq)",
  IWM: "var(--dot-iwm)",
  SPY: "var(--dot-spy)",
};

function toneColor(tone: ReturnType<typeof moveTone>): string {
  if (tone === "bull") return "var(--accent-bull)";
  if (tone === "bear") return "var(--accent-bear)";
  return "var(--text-muted)";
}

function Chevron({ tone }: { tone: ReturnType<typeof moveTone> }) {
  if (tone === "flat") return <span className="w-3" />;
  const up = tone === "bull";
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ color: toneColor(tone) }}>
      {up ? (
        <path d="M6 2.2 10 8.2H2L6 2.2Z" fill="currentColor" />
      ) : (
        <path d="M6 9.8 2 3.8h8L6 9.8Z" fill="currentColor" />
      )}
    </svg>
  );
}

function Magnitude({ value, scale }: { value: number | null; scale: number }) {
  const tone = moveTone(value);
  return (
    <div className="mag-track" aria-hidden>
      <div
        className="mag-fill"
        style={{ width: `${barScale(value, scale)}%`, background: toneColor(tone) }}
      />
    </div>
  );
}

function QuoteCard({ quote }: { quote: RotationQuote }) {
  const tone = moveTone(quote.dayPct);
  const dot = DOT[quote.symbol] ?? "var(--accent-info)";
  return (
    <Link href={`/ticker/${quote.symbol}`} className="quote-card block px-4 py-3.5 hover:bg-[var(--surface-alt)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide" style={{ color: dot }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden />
        {quote.symbol}
      </div>
      <div className="mt-2 font-display text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums text-[var(--text-primary)]">
        {formatPx(quote.last)}
      </div>
      <div className="mt-1.5 text-xs tabular-nums" style={{ color: toneColor(tone) }}>
        {signedPct(quote.dayPct)}
      </div>
      <div className="mt-3">
        <Magnitude value={quote.dayPct} scale={4} />
      </div>
    </Link>
  );
}

export function SectorRankList({
  sectors,
  limit,
  selected,
  onSelect,
}: {
  sectors: RotationSector[];
  limit?: number;
  selected?: string | null;
  onSelect?: (name: string) => void;
}) {
  const ranked = sectorRank(sectors);
  const visible = limit ? ranked.slice(0, limit) : ranked;
  if (!visible.length) {
    return (
      <p className="py-3 text-xs text-[var(--text-muted)]">
        No sector tape yet. The rank fills after the rotation compute.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {visible.map((row, index) => {
        const pct = row.rs4w == null ? null : row.rs4w * 100;
        const tone = moveTone(pct);
        const { tag, label } = sectorTag(row.name);
        const active = selected === row.name;
        const body = (
          <>
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
              style={{
                color: toneColor(tone),
                boxShadow: `inset 0 0 0 1px ${toneColor(tone)}`,
              }}
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-[var(--text-primary)]">{tag}</span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">{label}</span>
            </span>
            <span className="min-w-0">
              <Magnitude value={pct} scale={8} />
            </span>
            <span className="w-16 text-right text-[12px] tabular-nums" style={{ color: toneColor(tone) }}>
              {signedPct(pct)}
            </span>
            <Chevron tone={tone} />
          </>
        );
        const className = `grid w-full items-center gap-x-3 rounded-lg px-2 py-1.5 text-left ${
          active ? "bg-[var(--surface-alt)]" : "hover:bg-[var(--surface-alt)]"
        }`;
        const grid = { gridTemplateColumns: "1.25rem minmax(5.5rem, 9rem) minmax(0, 1fr) auto auto" };
        return (
          <li key={row.name}>
            {onSelect ? (
              <button
                type="button"
                className={className}
                style={grid}
                aria-pressed={active}
                onClick={() => onSelect(row.name)}
              >
                {body}
              </button>
            ) : (
              <div className={className} style={grid}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function MarketRotationTracker({
  quotes,
  sectors,
  asOf,
  unavailable,
  sectorLimit = 6,
  selectedSector,
  onSelectSector,
}: {
  quotes: RotationQuote[];
  sectors: RotationSector[];
  asOf?: string | null;
  unavailable?: boolean;
  sectorLimit?: number;
  selectedSector?: string | null;
  onSelectSector?: (name: string) => void;
}) {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const indexes = ROTATION_INDEXES.map(
    (meta) =>
      bySymbol.get(meta.symbol) ?? {
        symbol: meta.symbol,
        label: meta.label,
        last: null,
        dayPct: null,
      }
  );
  const qqq = indexes.find((quote) => quote.symbol === "QQQ")?.dayPct ?? null;
  const iwm = indexes.find((quote) => quote.symbol === "IWM")?.dayPct ?? null;
  const spread = indexSpread(iwm, qqq);
  const call = spreadCall(spread);
  const meter = spreadMeter(spread);
  const rest = quotes.filter((quote) => !ROTATION_INDEXES.some((meta) => meta.symbol === quote.symbol));
  const printed = latestDate([asOf, ...indexes.map((quote) => quote.asOf)]);

  return (
    <DeskWidget
      title="Market Rotation Tracker"
      menu={[
        { href: "/rotate", label: "Open rotation desk" },
        { href: "/ticker/QQQ", label: "QQQ chart" },
        { href: "/ticker/IWM", label: "IWM chart" },
      ]}
      footer={
        <>
          <span>{unavailable ? "Tape unavailable" : `Prices · EOD · ${printed ?? "—"}`}</span>
          <span>US ETFs · session move</span>
        </>
      }
    >
      <p className="section-label mb-3">Market rotation</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {indexes.map((quote) => (
          <QuoteCard key={quote.symbol} quote={quote} />
        ))}
      </div>
      {indexes.every((quote) => quote.last == null) && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          QQQ, IWM, and SPY are not in the price tape, so the spread stays blank.
        </p>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-label">IWM vs QQQ spread</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-display text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums">
                {spread == null ? "—" : `${spread > 0 ? "+" : ""}${spread.toFixed(2)}`}
                {spread != null && (
                  <span className="ml-1 text-sm font-medium text-[var(--text-muted)]">pp</span>
                )}
              </span>
              {call && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ color: "var(--dot-iwm)", background: "rgba(167, 139, 250, 0.12)" }}
                >
                  {call}
                </span>
              )}
            </div>
          </div>
          <p className="text-[11px] tabular-nums text-[var(--text-muted)]">
            IWM {signedPct(iwm)} · QQQ {signedPct(qqq)}
          </p>
        </div>
        <div className="relative mt-3">
          <div className="mag-track h-1.5">
            <div
              className="mag-fill absolute top-0"
              style={{
                left: `${meter.left}%`,
                width: `${meter.width}%`,
                background: "var(--dot-iwm)",
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-[var(--text-muted)]">
            <span>← QQQ leads</span>
            <span>IWM leads →</span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="section-label">Sector rotation</p>
          <p className="text-[10px] text-[var(--text-muted)]">Ranked strongest → weakest · 4-week RS</p>
        </div>
        <SectorRankList
          sectors={sectors}
          limit={sectorLimit}
          selected={selectedSector}
          onSelect={onSelectSector}
        />
        {sectors.length > sectorLimit && (
          <Link href="/rotate" className="mt-2 inline-block text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {sectors.length - sectorLimit} more on the rotation desk
          </Link>
        )}
      </div>

      {rest.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {rest.map((quote) => {
            const tone = moveTone(quote.dayPct);
            return (
              <Link
                key={quote.symbol}
                href={`/ticker/${quote.symbol}`}
                className="rounded-full border border-[var(--panel-border)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
              >
                <span className="font-semibold text-[var(--text-primary)]">{quote.symbol}</span>{" "}
                <span className="tabular-nums" style={{ color: toneColor(tone) }}>
                  {signedPct(quote.dayPct)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </DeskWidget>
  );
}

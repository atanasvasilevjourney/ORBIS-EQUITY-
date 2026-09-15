"use client";

import type { TemaBar, TemaReadout } from "@/lib/tema";

function sideColor(s: string | null | undefined) {
  if (s === "BUY" || s === "LONG") return "var(--accent-bull)";
  if (s === "SELL" || s === "SHORT") return "var(--accent-bear)";
  return "var(--text-muted)";
}

export function TemaRibbon({
  bars,
  readout,
  title,
}: {
  bars: TemaBar[];
  readout: TemaReadout | null;
  title?: string;
}) {
  const slice = bars.slice(-140);
  if (slice.length < 8) {
    return (
      <div className="text-xs text-[var(--text-muted)] font-terminal px-3 py-8 text-center">
        TEMA ribbon needs ≥220 daily closes (9/99/199). Load a name with a full cash book.
      </div>
    );
  }
  const w = 720;
  const hPrice = 220;
  const hMacd = 88;
  const pad = { l: 8, r: 8, t: 12, b: 8 };
  const innerW = w - pad.l - pad.r;
  const xs = slice.map((_, i) => pad.l + (i / (slice.length - 1)) * innerW);
  const px = slice.flatMap((b) => [b.close, b.tema9, b.tema99, b.tema199]);
  const yMin = Math.min(...px) * 0.995;
  const yMax = Math.max(...px) * 1.005;
  const Y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (hPrice - pad.t - pad.b);
  const path = (key: keyof TemaBar) =>
    slice.map((b, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${Y(Number(b[key])).toFixed(1)}`).join(" ");
  const fill = slice
    .map((b, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${Y(b.tema9).toFixed(1)}`)
    .join(" ")
    .concat(
      " " +
        [...slice]
          .reverse()
          .map((b, i) => `L${xs[slice.length - 1 - i].toFixed(1)},${Y(b.tema199).toFixed(1)}`)
          .join(" ") +
        " Z"
    );
  const macdAbs = Math.max(...slice.map((b) => Math.abs(b.macdHist)), 1e-6);
  const yMacd = (v: number) => 8 + (1 - (v / macdAbs + 1) / 2) * (hMacd - 16);

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest">
          {title ?? "TEMA 9 / 99 / 199 · MACD CLOSE"}
        </h2>
        {readout && (
          <div className="flex flex-wrap gap-3 text-xs font-terminal">
            <span style={{ color: sideColor(readout.side) }} className="font-bold">
              {readout.side} {readout.grade}
            </span>
            <span style={{ color: readout.macdAction === "HOLD" ? "var(--accent-bull)" : "var(--accent-bear)" }}>
              MACD {readout.macdAction}
            </span>
            <span className="text-[var(--text-muted)]">last {readout.last.toFixed(2)}</span>
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${hPrice}`} className="w-full h-56">
        <path d={fill} fill={readout?.side === "SELL" ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)"} />
        <path d={path("close")} fill="none" stroke="var(--text-secondary)" strokeWidth="1.2" />
        <path d={path("tema9")} fill="none" stroke="var(--accent-info)" strokeWidth="1.6" />
        <path d={path("tema99")} fill="none" stroke="var(--accent-warning)" strokeWidth="1.3" />
        <path d={path("tema199")} fill="none" stroke="var(--accent-bull)" strokeWidth="1.1" opacity="0.85" />
      </svg>
      <div className="flex gap-4 text-[10px] font-terminal text-[var(--text-muted)] tracking-widest px-1 mb-1">
        <span>PRICE</span>
        <span style={{ color: "var(--accent-info)" }}>TEMA 9</span>
        <span style={{ color: "var(--accent-warning)" }}>TEMA 99</span>
        <span style={{ color: "var(--accent-bull)" }}>TEMA 199 regime</span>
      </div>
      <svg viewBox={`0 0 ${w} ${hMacd}`} className="w-full h-20">
        {slice.map((b, i) => (
          <rect
            key={b.time + i}
            x={xs[i] - 1.2}
            y={Math.min(yMacd(0), yMacd(b.macdHist))}
            width="2.4"
            height={Math.max(1, Math.abs(yMacd(b.macdHist) - yMacd(0)))}
            fill={b.macdHist >= 0 ? "var(--accent-bull)" : "var(--accent-bear)"}
            opacity="0.85"
          />
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={yMacd(0)} y2={yMacd(0)} stroke="var(--border)" />
      </svg>
      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-1">
        Ribbon = 9 vs 199. Trigger is 9 vs 99; 199 is the regime. MACD(12,26,9) histogram is the systematic close.
        Paper overlay on listed closes — not a live order.
      </p>
    </div>
  );
}

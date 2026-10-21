"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function DataHonestyBar() {
  const [pricesAsOf, setPricesAsOf] = useState<string>("—");
  const [expected, setExpected] = useState<string>("—");
  const [stale, setStale] = useState(false);
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => {
        if (d?.pricesAsOf) setPricesAsOf(d.pricesAsOf);
        if (d?.freshness?.expectedEodDate) setExpected(d.freshness.expectedEodDate);
        if (d?.freshness?.stale) setStale(true);
        if (d?.freshness?.signalsSuppressed) setSuppressed(true);
      })
      .catch(() => {
        fetch("/api/summary")
          .then((r) => r.json())
          .then((s) => {
            if (s?.pricesAsOf) setPricesAsOf(s.pricesAsOf);
            if (s?.asOfDate) setPricesAsOf((p) => (p === "—" ? s.asOfDate : p));
            if (s?.stale) setStale(true);
            if (s?.signalsSuppressed) setSuppressed(true);
          })
          .catch(() => {});
      });
  }, []);

  const live = !stale && !suppressed;

  return (
    <div
      className="w-full border-b border-[var(--border)] px-3 sm:px-5 py-2 text-[11px] font-terminal tracking-wide text-[var(--text-muted)] flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{
        background: "var(--panel-bg)",
        backdropFilter: "blur(12px)",
      }}
    >
      <span
        className="inline-flex items-center gap-1.5"
        title={live ? "Tape within freshness window" : "Check status"}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: live ? "var(--accent-bull)" : "var(--accent-warning)",
            boxShadow: live
              ? "0 0 8px var(--accent-bull)"
              : "0 0 8px var(--accent-warning)",
          }}
        />
        EOD {pricesAsOf}
      </span>
      <span className="hidden sm:inline">· expect ≥ {expected}</span>
      <span className="hidden md:inline">· refresh ~19:30 UTC</span>
      <span className="text-[var(--text-muted)]">· delayed data</span>
      <Link href="/status" className="text-[var(--accent-info)] hover:underline ml-auto sm:ml-0">
        Status
      </Link>
      {stale && (
        <span className="text-[var(--accent-warning)] font-semibold">Stale tape</span>
      )}
      {suppressed && (
        <span className="text-[var(--accent-bear)] font-semibold">Signals off</span>
      )}
    </div>
  );
}

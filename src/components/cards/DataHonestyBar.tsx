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

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      PRICES AS OF: {pricesAsOf} EOD &middot; EXPECT ≥ {expected} &middot; REFRESH ~19:30 UTC &middot;
      EOD/DELAYED — NOT REAL-TIME
      <Link href="/status" className="ml-2 text-[var(--accent-info)] hover:underline">
        STATUS
      </Link>
      {stale && (
        <span className="ml-2 text-[var(--accent-warning)] font-bold">
          &middot; STALE TAPE
        </span>
      )}
      {suppressed && (
        <span className="ml-2 text-[var(--accent-bear)] font-bold">
          &middot; BUY/SELL SIGNALS OFF
        </span>
      )}
    </div>
  );
}

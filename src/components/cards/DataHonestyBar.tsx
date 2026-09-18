"use client";

import { useEffect, useState } from "react";

type Tape = { configured: boolean; streaming: boolean; names: number };

export function DataHonestyBar() {
  const [asOfDate, setAsOfDate] = useState<string>("—");
  const [stale, setStale] = useState(false);
  const [tape, setTape] = useState<Tape | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/summary")
        .then((r) => r.json())
        .then((d) => {
          if (d?.asOfDate) setAsOfDate(d.asOfDate);
          setStale(Boolean(d?.stale));
        })
        .catch(() => {});
      fetch("/api/quotes")
        .then((r) => r.json())
        .then((d) => {
          setTape({
            configured: Boolean(d?.configured),
            streaming: Boolean(d?.streaming),
            names: Array.isArray(d?.quotes) ? d.quotes.length : 0,
          });
        })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, []);

  const lseLine =
    tape == null
      ? "LSE …"
      : tape.streaming
        ? `LSE WS TICKS${tape.names ? ` · ${tape.names} LAST $` : ""}`
        : tape.configured
          ? "LSE KEY SET — RUN python -m pipeline.ingest.lse_live"
          : "LSE: KEY MISSING — NOT STREAMING";

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      CASH CLOSE: {asOfDate} &middot; EOD BOOK &middot; {lseLine} &middot; 5m: LSE VAULT THEN YAHOO
      {stale && (
        <span className="ml-2 text-[var(--accent-bear)] font-bold">
          &middot; DATA MAY BE STALE — CHECK PIPELINE
        </span>
      )}
    </div>
  );
}

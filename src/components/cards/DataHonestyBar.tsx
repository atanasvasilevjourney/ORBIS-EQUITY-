"use client";

import { useEffect, useState } from "react";

type Tape = { source: string | null; lastClose: string | null; names: number };
type Session = {
  state: string;
  label: string;
  lastClosedSession: string;
  workday: boolean;
  lseStreaming: boolean;
  lseConfigured?: boolean;
  lseQuoteNames?: number;
};

export function DataHonestyBar() {
  const [asOfDate, setAsOfDate] = useState<string>("—");
  const [stale, setStale] = useState(false);
  const [tape, setTape] = useState<Tape | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/summary")
        .then((r) => r.json())
        .then((d) => {
          if (d?.asOfDate) setAsOfDate(d.asOfDate);
          if (d?.stale) setStale(true);
          if (d?.tape) setTape(d.tape);
          if (d?.session) setSession(d.session);
        })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, []);

  const src = (tape?.source ?? "EOD").toUpperCase();
  const names = tape?.names ? `${tape.names} NAMES` : null;
  const lseLine = session?.lseStreaming
    ? `LSE WS TICKS${session.lseQuoteNames ? ` · ${session.lseQuoteNames} LAST $` : ""}`
    : session?.lseConfigured
      ? "LSE KEY SET — RUN python -m pipeline.ingest.lse_live"
      : "LSE: KEY MISSING — NOT STREAMING";

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      CASH CLOSE: {asOfDate} &middot; {src}
      {names ? ` · ${names}` : ""} &middot; {session?.label ?? "EOD/DELAYED — NOT REAL-TIME"}{" "}
      &middot; {lseLine} &middot; 5m: LSE VAULT THEN YAHOO
      {stale && (
        <span className="ml-2 text-[var(--accent-bear)] font-bold">
          &middot; DATA MAY BE STALE — CHECK PIPELINE
        </span>
      )}
    </div>
  );
}

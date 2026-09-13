"use client";

import { useEffect, useState } from "react";

type Tape = { source: string | null; lastClose: string | null; names: number };
type Session = {
  state: string;
  label: string;
  lastClosedSession: string;
  workday: boolean;
  lseStreaming: boolean;
};

export function DataHonestyBar() {
  const [asOfDate, setAsOfDate] = useState<string>("—");
  const [stale, setStale] = useState(false);
  const [tape, setTape] = useState<Tape | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d?.asOfDate) setAsOfDate(d.asOfDate);
        if (d?.stale) setStale(true);
        if (d?.tape) setTape(d.tape);
        if (d?.session) setSession(d.session);
      })
      .catch(() => {});
  }, []);

  const src = (tape?.source ?? "EOD").toUpperCase();
  const names = tape?.names ? `${tape.names} NAMES` : null;

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      CASH CLOSE: {asOfDate} &middot; {src}
      {names ? ` · ${names}` : ""} &middot; {session?.label ?? "EOD/DELAYED — NOT REAL-TIME"}{" "}
      &middot; LSE: BATCH REST — NOT STREAMING &middot; YAHOO 5m ON REQUEST
      {stale && (
        <span className="ml-2 text-[var(--accent-bear)] font-bold">
          &middot; DATA MAY BE STALE — CHECK PIPELINE
        </span>
      )}
    </div>
  );
}

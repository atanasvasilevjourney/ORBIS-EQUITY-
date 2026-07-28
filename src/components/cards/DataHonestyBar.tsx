"use client";

import { useEffect, useState } from "react";

export function DataHonestyBar() {
  const [asOfDate, setAsOfDate] = useState<string>("—");
  const [stale, setStale] = useState(false);

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d?.asOfDate) setAsOfDate(d.asOfDate);
        if (d?.stale) setStale(true);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      DATA AS OF: {asOfDate} EOD &middot; NEXT REFRESH: ~19:30 UTC &middot;
      EOD/DELAYED — NOT REAL-TIME
      {stale && (
        <span className="ml-2 text-[var(--accent-bear)] font-bold">
          &middot; DATA MAY BE STALE — CHECK PIPELINE
        </span>
      )}
    </div>
  );
}

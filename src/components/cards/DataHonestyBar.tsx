"use client";

import { useEffect, useState } from "react";

export function DataHonestyBar() {
  const [asOfDate, setAsOfDate] = useState<string>("—");

  useEffect(() => {
    fetch("/api/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d?.asOfDate) setAsOfDate(d.asOfDate);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      DATA AS OF: {asOfDate} EOD &middot; NEXT REFRESH: ~19:30 UTC &middot;
      EOD/DELAYED — NOT REAL-TIME
    </div>
  );
}

"use client";

export function DataHonestyBar({ asOfDate }: { asOfDate?: string }) {
  const dateStr = asOfDate || "—";
  return (
    <div className="w-full bg-[var(--badge-bg)] border-b border-[var(--border)] px-4 py-1.5 text-xs font-terminal tracking-wide text-[var(--text-muted)]">
      DATA AS OF: {dateStr} EOD &middot; NEXT REFRESH: ~19:30 UTC &middot;
      EOD/DELAYED — NOT REAL-TIME
    </div>
  );
}

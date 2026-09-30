"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { chartHref } from "@/lib/chartDesk";
import { recentTickers } from "@/components/command/CommandPalette";

export default function ChartIndexPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const recents = useMemo(() => recentTickers(), []);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim().toUpperCase();
    if (t) router.push(chartHref(t));
  }

  return (
    <div className="px-4 py-10 max-w-lg">
      <h1 className="text-sm font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
        CHART
      </h1>
      <p className="mt-1 text-[10px] font-terminal text-[var(--text-muted)]">
        Separate module · click a PLAY ticker or type a name. Full pane, no side strip.
      </p>
      <form onSubmit={go} className="mt-6 flex">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticker…"
          autoFocus
          className="flex-1 px-3 py-2 text-sm font-terminal rounded-l border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="submit"
          className="px-3 py-2 text-xs font-terminal rounded-r border border-l-0 border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-secondary)]"
        >
          OPEN
        </button>
      </form>
      {recents.length ? (
        <div className="mt-6">
          <div className="text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">RECENT</div>
          <ul className="mt-2 space-y-1">
            {recents.map((t) => (
              <li key={t}>
                <Link href={chartHref(t)} className="text-sm font-terminal hover:text-[var(--accent-info)]">
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-6 text-xs font-terminal text-[var(--text-muted)]">
          No recents. Open PLAY and click a name, or jump with ⌘K.
        </p>
      )}
    </div>
  );
}

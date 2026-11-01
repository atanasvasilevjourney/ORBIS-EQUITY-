"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/fundamentals", label: "RANKINGS", hint: "Sort & chip filters" },
  { href: "/factors", label: "FACTOR DESK", hint: "Style sleeves & leaders" },
  { href: "/fundamentals/screener", label: "SCREENER", hint: "Ranges & presets" },
] as const;

export function FundamentalsModuleTabs() {
  const pathname = usePathname();
  const onScreener = pathname.startsWith("/fundamentals/screener");
  const onFactors = pathname.startsWith("/factors");

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div
        className="inline-flex rounded border border-[var(--border)] bg-[var(--card-bg)] p-0.5"
        role="tablist"
        aria-label="Fundamentals module"
      >
        {TABS.map((tab) => {
          const active =
            tab.href === "/fundamentals/screener"
              ? onScreener
              : tab.href === "/factors"
                ? onFactors
                : pathname === "/fundamentals" || pathname === "/fundamentals/";
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={`px-4 py-2 text-xs font-terminal rounded transition-colors ${
                active
                  ? "bg-[var(--badge-bg)] text-[var(--accent-info)] border border-[var(--accent-info)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        {onScreener
          ? "MODULE 2B · From/To ranges, Graham/Lynch/Conviction presets"
          : onFactors
            ? "MODULE 2 · Cross-sectional factor sleeves, leaders, sector breadth"
            : "MODULE 2 · Full factor table with quick tier chips"}
      </p>
    </div>
  );
}

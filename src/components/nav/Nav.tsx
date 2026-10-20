"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/cards/ThemeToggle";

const NAV_PRIMARY = [
  { href: "/", label: "COCKPIT" },
  { href: "/screener", label: "WATCHLIST" },
  { href: "/loop", label: "LOOP" },
  { href: "/rotate", label: "ROTATE" },
  { href: "/quantropy", label: "QUANT" },
  { href: "/fundamentals", label: "FUNDAMENTALS" },
];

const NAV_MORE = [
  { href: "/ema200", label: "EMA200" },
  { href: "/orb", label: "ORB" },
  { href: "/skew", label: "SKEW" },
  { href: "/analysis", label: "ANALYZE" },
  { href: "/bias", label: "BIAS" },
  { href: "/triangle", label: "TRI" },
  { href: "/cash", label: "CASH" },
  { href: "/fundamentals/screener", label: "FA SCR" },
  { href: "/health", label: "HEALTH" },
  { href: "/earnings-news", label: "EARNINGS" },
  { href: "/status", label: "STATUS" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = search.trim().toUpperCase();
    if (ticker) {
      router.push(`/ticker/${ticker}`);
      setSearch("");
    }
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--panel-bg)] backdrop-blur-xl"
      style={{ boxShadow: "var(--shadow-panel)" }}
    >
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 flex items-center justify-between gap-4 py-2.5">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/" className="shrink-0 group">
            <span
              className="font-display text-lg font-semibold tracking-tight"
              style={{
                background: "var(--gradient-brand)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              ORBIS
            </span>
            <span className="hidden sm:inline font-terminal text-[10px] text-[var(--text-muted)] ml-1.5 tracking-widest">
              EQUITY
            </span>
          </Link>
          <div className="hidden lg:flex items-center gap-0.5 overflow-x-auto max-w-[42rem]">
            {NAV_PRIMARY.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link-pill"
                data-active={isActive(l.href)}
              >
                {l.label}
              </Link>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className="nav-link-pill"
                data-active={NAV_MORE.some((m) => isActive(m.href))}
              >
                MORE ▾
              </button>
              {moreOpen && (
                <div
                  className="absolute left-0 top-full mt-1 py-2 px-1 min-w-[11rem] glass-panel z-50 grid gap-0.5"
                  onMouseLeave={() => setMoreOpen(false)}
                >
                  {NAV_MORE.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMoreOpen(false)}
                      className="nav-link-pill block text-left"
                      data-active={isActive(l.href)}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("orbis:open-palette"))}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-terminal rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-info)] transition-colors"
          >
            <span>⌘K</span>
          </button>
          <form onSubmit={handleSearch} className="hidden sm:flex">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ticker"
              className="w-20 sm:w-24 px-2.5 py-1.5 text-xs font-terminal rounded-l-full border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-info)]"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-terminal rounded-r-full border border-l-0 border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-muted)] hover:text-[var(--accent-info)]"
            >
              →
            </button>
          </form>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1.5 rounded-full border border-[var(--border)]"
            aria-label="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
              {mobileOpen ? (
                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="lg:hidden border-t border-[var(--border)] px-3 py-3 space-y-1 bg-[var(--surface-alt)]">
          <form onSubmit={handleSearch} className="flex mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker..."
              className="flex-1 px-3 py-2 text-xs font-terminal rounded-l-full border border-[var(--border)] bg-[var(--card-bg)]"
            />
            <button type="submit" className="px-4 py-2 text-xs font-terminal rounded-r-full border border-l-0 border-[var(--border)] bg-[var(--surface-alt)]">
              GO
            </button>
          </form>
          {[...NAV_PRIMARY, ...NAV_MORE].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              className="nav-link-pill block"
              data-active={isActive(l.href)}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

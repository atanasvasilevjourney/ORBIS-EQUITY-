"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/cards/ThemeToggle";

const NAV_LINKS = [
  { href: "/screener", label: "SCREENER" },
  { href: "/fundamentals", label: "FUNDAMENTALS" },
  { href: "/pharma", label: "PHARMA" },
  { href: "/earnings-news", label: "EARNINGS" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = search.trim().toUpperCase();
    if (ticker) {
      router.push(`/ticker/${ticker}`);
      setSearch("");
    }
  };

  return (
    <nav className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold font-terminal tracking-widest"
            style={{ color: "var(--accent-info)" }}
          >
            KOVAVIEW
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((l) => {
              const isActive = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-1.5 text-xs font-terminal rounded transition-colors ${
                    isActive
                      ? "bg-[var(--badge-bg)] text-[var(--accent-info)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)]"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Ticker search */}
          <form onSubmit={handleSearch} className="hidden sm:flex">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ticker..."
              className="w-24 px-2 py-1 text-xs font-terminal rounded-l border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-info)]"
            />
            <button
              type="submit"
              className="px-2 py-1 text-xs font-terminal rounded-r border border-l-0 border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              GO
            </button>
          </form>
          <ThemeToggle />
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              {mobileOpen ? (
                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] px-4 py-2 space-y-1">
          {/* Mobile search */}
          <form onSubmit={handleSearch} className="flex mb-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker..."
              className="flex-1 px-2 py-1.5 text-xs font-terminal rounded-l border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-terminal rounded-r border border-l-0 border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text-muted)]"
            >
              GO
            </button>
          </form>
          {NAV_LINKS.map((l) => {
            const isActive = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-3 py-2 text-xs font-terminal rounded transition-colors ${
                  isActive
                    ? "bg-[var(--badge-bg)] text-[var(--accent-info)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

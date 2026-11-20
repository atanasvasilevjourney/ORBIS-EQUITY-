"use client";

import Link from "next/link";
import { ModulePanel } from "@/components/ui/ModulePanel";
import type { BriefNewsItem } from "@/lib/briefNews";

export type EarningsChip = {
  ticker: string;
  eventDate: string;
  confirmed: boolean;
  surprisePct: number | null;
  epsEst: number | null;
};

function stamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  return (
    date.toLocaleString("en-GB", {
      timeZone: "America/New_York",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " ET"
  );
}

function sourceLabel(source: "desk" | "yahoo" | "mixed" | "none" | null): string {
  if (source === "desk") return "DESK";
  if (source === "yahoo") return "YAHOO";
  if (source === "mixed") return "DESK · YAHOO";
  return "NEWS";
}

function surpriseLabel(row: EarningsChip): string {
  if (!row.confirmed) return row.epsEst != null ? `est ${row.epsEst.toFixed(2)}` : row.eventDate.slice(5);
  if (row.surprisePct == null) return "reported";
  const sign = row.surprisePct > 0 ? "+" : "";
  return `${sign}${row.surprisePct.toFixed(1)}%`;
}

export function BriefNews({
  items,
  source,
  loading,
  earnings,
}: {
  items: BriefNewsItem[];
  source: "desk" | "yahoo" | "mixed" | "none" | null;
  loading: boolean;
  earnings?: {
    beats: number;
    misses: number;
    upcoming: number;
    names: EarningsChip[];
  } | null;
}) {
  return (
    <ModulePanel
      title="Brief news"
      badge="FINANCIAL INTELLIGENCE"
      subtitle="Earnings names first, then the session tape"
      accent="var(--module-4)"
      source={sourceLabel(source)}
      actions={
        <Link href="/earnings-news" className="text-[10px] font-terminal tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          EARNINGS DESK
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <div className="h-4 bg-[var(--surface-alt)] rounded animate-pulse" />
          <div className="h-4 bg-[var(--surface-alt)] rounded animate-pulse w-5/6" />
          <div className="h-4 bg-[var(--surface-alt)] rounded animate-pulse w-2/3" />
        </div>
      ) : (
        <>
      {earnings && (earnings.names.length > 0 || earnings.upcoming + earnings.beats + earnings.misses > 0) && (
        <div className="mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="section-label">Earnings</p>
            <p className="text-[10px] font-terminal text-[var(--text-muted)]">
              {earnings.beats} beats · {earnings.misses} misses · {earnings.upcoming} upcoming
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {earnings.names.map((row) => {
              const beat = row.confirmed && (row.surprisePct ?? 0) > 0;
              const miss = row.confirmed && (row.surprisePct ?? 0) < 0;
              return (
                <Link
                  key={`${row.ticker}-${row.eventDate}`}
                  href={`/earnings-news?ticker=${row.ticker}`}
                  className="rounded-full border border-[var(--panel-border)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-alt)]"
                >
                  <span className="font-semibold text-[var(--text-primary)]">{row.ticker}</span>{" "}
                  <span
                    className="tabular-nums"
                    style={{
                      color: beat ? "var(--accent-bull)" : miss ? "var(--accent-bear)" : "var(--text-secondary)",
                    }}
                  >
                    {surpriseLabel(row)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          No headlines yet for these earnings names. The calendar above still links through to the earnings desk.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--panel-border)]">
          {items.map((item) => {
            const tone =
              item.tone == null ? null : item.tone > 1 ? "bull" : item.tone < -1 ? "bear" : "flat";
            const body = (
              <>
                <span className="block text-sm font-medium leading-snug text-[var(--text-primary)]">
                  {item.headline}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-terminal tracking-wide text-[var(--text-muted)]">
                  {item.ticker && <span className="text-[var(--text-secondary)]">{item.ticker}</span>}
                  {item.badge === "earnings" && (
                    <span style={{ color: "var(--accent-info)" }}>EARN</span>
                  )}
                  <span>{item.source}</span>
                  {stamp(item.publishedAt) && <span>{stamp(item.publishedAt)}</span>}
                  <span>{item.origin === "desk" ? "DESK" : "YAHOO"}</span>
                  {tone && tone !== "flat" && (
                    <span style={{ color: tone === "bull" ? "var(--accent-bull)" : "var(--accent-bear)" }}>
                      {tone === "bull" ? "POS" : "NEG"} {item.tone?.toFixed(1)}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="block hover:opacity-80">
                    {body}
                  </a>
                ) : item.ticker ? (
                  <Link href={`/ticker/${item.ticker}`} className="block hover:opacity-80">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ol>
      )}
        </>
      )}
    </ModulePanel>
  );
}

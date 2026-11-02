"use client";

import Link from "next/link";
import { ModulePanel } from "@/components/ui/ModulePanel";
import type { BriefNewsItem } from "@/lib/briefNews";

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

export function BriefNews({
  items,
  source,
  loading,
}: {
  items: BriefNewsItem[];
  source: "desk" | "yahoo" | "mixed" | "none" | null;
  loading: boolean;
}) {
  return (
    <ModulePanel
      title="Brief news"
      badge="FINANCIAL INTELLIGENCE"
      subtitle="Session headlines, desk first"
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
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          No headlines yet. The desk news window is empty, and the public tape did not return a story.
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
    </ModulePanel>
  );
}

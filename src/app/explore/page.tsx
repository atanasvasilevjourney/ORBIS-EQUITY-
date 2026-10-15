"use client";

import Link from "next/link";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { DeskUniverseEditor } from "@/components/universe/DeskUniverseEditor";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { deskEma200Href } from "@/lib/focusUniverse";

export default function ExplorePage() {
  const { mode, symbols } = useFocusUniverse();

  const moduleLinks = symbols.length
    ? [
        { href: "/screener", label: "Watchlist" },
        { href: deskEma200Href(symbols), label: "EMA200 ribbon scan" },
        { href: "/bias", label: "Daily bias" },
        { href: "/analysis", label: "Analyze" },
      ]
    : [];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="EXPLORE"
        title="NASDAQ DESK LIST"
        description="Search the broader Nasdaq venue and manage your desk list. Use the universe strip under the nav on any page to switch Index desk vs My list — this page is the full editor."
        source="Yahoo search · client-side list"
        accent="var(--accent-desk)"
      />

      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        Active mode:{" "}
        <strong style={{ color: mode === "focus" ? "var(--accent-desk)" : "var(--accent-info)" }}>
          {mode === "focus" ? `My list (${symbols.length})` : "Index desk"}
        </strong>
        . Toggle in the strip above or on any module page.
      </p>

      <ModulePanel title="Desk list editor" badge="live" accent="var(--accent-desk)">
        <div className="p-3">
          <DeskUniverseEditor />
        </div>
      </ModulePanel>

      {mode === "focus" && moduleLinks.length > 0 && (
        <ModulePanel title="Open modules" badge="focus" accent="var(--accent-desk)">
          <div className="p-3 flex flex-wrap gap-2">
            {moduleLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs px-2 py-1 rounded border border-[var(--accent-desk)] text-[var(--accent-desk)]"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </ModulePanel>
      )}
    </div>
  );
}

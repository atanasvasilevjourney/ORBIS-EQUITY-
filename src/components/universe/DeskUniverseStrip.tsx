"use client";

import Link from "next/link";
import { FilterChip } from "@/components/ui/FilterChip";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { splitDeskChipPreview } from "@/lib/focusUniverse";
import { INDEX_DESKS, DESK_SHORT, type IndexDeskId } from "@/lib/universeDesk";
import { DeskSymbolChip } from "@/components/universe/DeskSymbolChip";
import { useDeskUniverseUi } from "@/components/universe/deskUniverseUiContext";

export function DeskUniverseStrip() {
  const { desk, symbols, setDesk, isWatchlist } = useFocusUniverse();
  const { openDrawer, showFirstAddNudge, acceptFirstAddNudge, dismissFirstAddNudgeUi } =
    useDeskUniverseUi();
  const accent = isWatchlist ? "var(--accent-desk)" : "var(--accent-info)";
  const { visible, hiddenCount } = splitDeskChipPreview(symbols);

  return (
    <div className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--surface)]">
      <div
        className="w-full px-4 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px] font-terminal"
        data-universe-desk={desk}
      >
        <span className="text-[var(--text-muted)] uppercase tracking-wide shrink-0 w-full sm:w-auto">
          Index desks
        </span>
        {INDEX_DESKS.map((id: IndexDeskId) => (
          <FilterChip
            key={id}
            active={desk === id}
            onClick={() => setDesk(id)}
            label={DESK_SHORT[id]}
          />
        ))}
        <span className="hidden sm:inline w-px h-4 bg-[var(--panel-border)] mx-1" />
        <FilterChip
          active={isWatchlist}
          onClick={() => setDesk("watchlist")}
          label={`My watchlist (${symbols.length})`}
        />
        {desk === "nasdaq_all" && (
          <span
            className="text-[var(--text-muted)] max-w-md"
            title="Nasdaq-listed names in our synced universe — not every ticker on the exchange."
          >
            · synced Nasdaq names only
          </span>
        )}
        {isWatchlist && (
          <>
            {symbols.length === 0 ? (
              <button type="button" onClick={openDrawer} className="text-[var(--accent-desk)] underline">
                Empty · Add symbols
              </button>
            ) : (
              <>
                {visible.map((s) => (
                  <button key={s} type="button" onClick={openDrawer} className="inline-flex">
                    <DeskSymbolChip symbol={s} accent={accent} />
                  </button>
                ))}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={openDrawer}
                    className="text-[var(--text-muted)] hover:text-[var(--accent-desk)]"
                  >
                    +{hiddenCount} more
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={openDrawer}
              className="ml-auto text-[var(--accent-info)] hover:underline shrink-0"
            >
              Edit
            </button>
          </>
        )}
        {!isWatchlist && symbols.length > 0 && (
          <Link
            href="/explore"
            className="ml-auto text-[var(--text-muted)] hover:text-[var(--accent-desk)] shrink-0"
          >
            {symbols.length} on watchlist · Explore
          </Link>
        )}
      </div>
      {showFirstAddNudge && (
        <div
          className="mx-4 mb-2 px-3 py-2 rounded border text-xs font-terminal flex flex-wrap items-center gap-3"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-desk) 50%, var(--panel-border))",
            background: "color-mix(in srgb, var(--accent-desk) 8%, var(--surface-alt))",
          }}
          role="status"
        >
          <span className="text-[var(--text-secondary)]">
            Scan only these names in Watchlist &amp; EMA200?
          </span>
          <button
            type="button"
            onClick={acceptFirstAddNudge}
            className="px-2 py-1 rounded border font-semibold"
            style={{ borderColor: "var(--accent-desk)", color: "var(--accent-desk)" }}
          >
            Use my watchlist
          </button>
          <button type="button" onClick={dismissFirstAddNudgeUi} className="text-[var(--text-muted)] underline">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

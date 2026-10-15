"use client";

import Link from "next/link";
import { FilterChip } from "@/components/ui/FilterChip";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { splitDeskChipPreview } from "@/lib/focusUniverse";
import { DeskSymbolChip } from "@/components/universe/DeskSymbolChip";
import { useDeskUniverseUi } from "@/components/universe/deskUniverseUiContext";

export function DeskUniverseStrip() {
  const { mode, symbols, setMode } = useFocusUniverse();
  const { openDrawer, showFirstAddNudge, acceptFirstAddNudge, dismissFirstAddNudgeUi } =
    useDeskUniverseUi();
  const isFocus = mode === "focus";
  const accent = isFocus ? "var(--accent-desk)" : "var(--accent-info)";
  const { visible, hiddenCount } = splitDeskChipPreview(symbols);

  return (
    <div className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--surface)]">
    <div
      className="w-full px-4 py-2 flex flex-wrap items-center gap-2 text-[10px] font-terminal"
      style={{
        borderColor: isFocus
          ? "color-mix(in srgb, var(--accent-desk) 35%, var(--border))"
          : "var(--border)",
      }}
      data-universe-mode={mode}
    >
      <span className="text-[var(--text-muted)] uppercase tracking-wide shrink-0">Universe</span>
      <FilterChip active={mode === "index"} onClick={() => setMode("index")} label="Index desk" />
      <FilterChip
        active={mode === "focus"}
        onClick={() => setMode("focus")}
        label={`My list (${symbols.length})`}
      />
      {isFocus && (
        <>
          {symbols.length === 0 ? (
            <button
              type="button"
              onClick={openDrawer}
              className="text-[var(--accent-desk)] underline"
            >
              List empty · Add symbols
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
            className="ml-auto sm:ml-1 text-[var(--accent-info)] hover:underline shrink-0"
          >
            Edit
          </button>
        </>
      )}
      {!isFocus && symbols.length > 0 && (
        <Link href="/explore" className="ml-auto text-[var(--text-muted)] hover:text-[var(--accent-desk)] shrink-0">
          {symbols.length} saved · Explore
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
          Use my list
        </button>
        <button type="button" onClick={dismissFirstAddNudgeUi} className="text-[var(--text-muted)] underline">
          Not now
        </button>
      </div>
    )}
    </div>
  );
}

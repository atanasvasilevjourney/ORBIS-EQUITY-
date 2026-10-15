"use client";

import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { useDeskUniverseUi } from "@/components/universe/deskUniverseUiContext";

export function FocusUniverseModuleBanner() {
  const { desk, deskLabel, symbols, isWatchlist } = useFocusUniverse();
  const { openDrawer } = useDeskUniverseUi();

  if (desk === "sp500_ndx100") return null;

  if (isWatchlist) {
    if (symbols.length === 0) {
      return (
        <div
          className="px-3 py-2 rounded border text-[10px] font-terminal text-[var(--text-muted)]"
          style={{ borderColor: "color-mix(in srgb, var(--accent-desk) 40%, var(--panel-border))" }}
        >
          My watchlist is empty ·{" "}
          <button type="button" onClick={openDrawer} className="text-[var(--accent-desk)] underline">
            Add symbols
          </button>
        </div>
      );
    }
    return (
      <div
        className="px-3 py-2 rounded border text-[10px] font-terminal text-[var(--text-secondary)]"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-desk) 40%, var(--panel-border))",
          background: "color-mix(in srgb, var(--accent-desk) 6%, transparent)",
        }}
      >
        Scanning {symbols.length} symbol{symbols.length === 1 ? "" : "s"} from My watchlist ·{" "}
        <button type="button" onClick={openDrawer} className="text-[var(--accent-desk)] underline">
          Edit
        </button>
      </div>
    );
  }

  return (
    <div
      className="px-3 py-2 rounded border text-[10px] font-terminal text-[var(--text-secondary)]"
      style={{
        borderColor: "color-mix(in srgb, var(--accent-info) 35%, var(--panel-border))",
        background: "color-mix(in srgb, var(--accent-info) 5%, transparent)",
      }}
    >
      Universe: <strong>{deskLabel}</strong> · index desk subset (nightly radar where available)
    </div>
  );
}

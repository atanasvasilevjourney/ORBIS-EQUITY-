"use client";

import Link from "next/link";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { FilterChip } from "@/components/ui/FilterChip";

type Props = {
  moduleLabel?: string;
};

export function FocusUniverseBar({ moduleLabel }: Props) {
  const { mode, symbols, setMode, isFocusActive } = useFocusUniverse();

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-terminal">
      <span className="text-[var(--text-muted)] uppercase tracking-wide">
        Universe{moduleLabel ? ` · ${moduleLabel}` : ""}
      </span>
      <FilterChip active={mode === "index"} onClick={() => setMode("index")} label="Index desk" />
      <FilterChip
        active={mode === "focus"}
        onClick={() => setMode("focus")}
        label={`My Nasdaq list (${symbols.length})`}
      />
      {mode === "focus" && symbols.length === 0 && (
        <Link href="/explore" className="text-[var(--accent-info)] hover:underline">
          Add symbols in Explore →
        </Link>
      )}
      {isFocusActive && (
        <span className="text-[var(--text-muted)]">
          Scanning {symbols.length} name{symbols.length === 1 ? "" : "s"} ·{" "}
          <Link href="/explore" className="text-[var(--accent-info)] hover:underline">edit</Link>
        </span>
      )}
    </div>
  );
}

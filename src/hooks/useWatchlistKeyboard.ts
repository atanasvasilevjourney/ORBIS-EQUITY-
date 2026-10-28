"use client";

import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

type Options = {
  symbols: string[];
  selected: string | null;
  onSelect: (symbol: string) => void;
  onInterval?: (tf: "1d" | "5m") => void;
  enabled?: boolean;
};

/** TOS-style keyboard: ↑↓ move selection, D / 5 switch chart interval. */
export function useWatchlistKeyboard({
  symbols,
  selected,
  onSelect,
  onInterval,
  enabled = true,
}: Options) {
  useEffect(() => {
    if (!enabled || symbols.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = selected ? symbols.indexOf(selected) : -1;
        const next =
          e.key === "ArrowDown"
            ? symbols[(idx + 1 + symbols.length) % symbols.length]
            : symbols[(idx - 1 + symbols.length) % symbols.length];
        onSelect(next);
        return;
      }

      if (onInterval && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        onInterval("1d");
        return;
      }
      if (onInterval && e.key === "5") {
        e.preventDefault();
        onInterval("5m");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, symbols, selected, onSelect, onInterval]);
}

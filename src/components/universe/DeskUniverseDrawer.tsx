"use client";

import { useEffect } from "react";
import { DeskUniverseEditor } from "@/components/universe/DeskUniverseEditor";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function DeskUniverseDrawer({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Edit my Nasdaq list">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        onClick={onClose}
      />
      <aside
        className="absolute top-0 right-0 h-full w-full max-w-md border-l border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-2xl flex flex-col"
        style={{ borderColor: "color-mix(in srgb, var(--accent-desk) 25%, var(--panel-border))" }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--panel-border)]">
          <h2 className="text-sm font-terminal font-bold tracking-wide" style={{ color: "var(--accent-desk)" }}>
            MY NASDAQ LIST
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none px-2"
            aria-label="Close panel"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <DeskUniverseEditor compact />
        </div>
      </aside>
    </div>
  );
}

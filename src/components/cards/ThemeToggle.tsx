"use client";

import { useTheme } from "@/lib/theme/ThemeProvider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="px-2 py-1 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors"
      title={`Switch to ${theme === "neon" ? "paper" : "neon"} theme`}
    >
      {theme === "neon" ? "PAPER" : "NEON"}
    </button>
  );
}

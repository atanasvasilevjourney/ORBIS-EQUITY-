"use client";

import { useTheme } from "@/lib/theme/ThemeProvider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={`Switch to ${theme === "neon" ? "paper" : "neon"} theme`}
      className="px-3 py-1.5 text-[10px] font-terminal tracking-wider rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent-info)] hover:border-[var(--accent-info)] transition-all shrink-0"
      style={{ background: "var(--card-bg)" }}
      title={`Switch to ${theme === "neon" ? "paper" : "neon"} theme`}
    >
      {theme === "neon" ? "◐ Paper" : "◑ Neon"}
    </button>
  );
}

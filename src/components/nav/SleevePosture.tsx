"use client";

import { usePathname } from "next/navigation";

const RESEARCH = [
  "/orb",
  "/skew",
  "/analysis",
  "/bias",
  "/triangle",
  "/cash",
  "/rotate",
  "/quantropy",
  "/perps",
];

type Tone = "info" | "warning";

function Bar({ label, tone, children }: { label: string; tone: Tone; children: string }) {
  const color = tone === "warning" ? "var(--accent-warning)" : "var(--accent-info)";
  return (
    <div className="px-4 py-1.5 text-[10px] font-terminal tracking-wide border-b border-[var(--border)] bg-[var(--badge-bg)] text-[var(--text-secondary)]">
      <span className="font-bold" style={{ color }}>{label}</span>
      {" · "}
      {children}
    </div>
  );
}

export function SleevePosture() {
  const path = usePathname() || "/";
  if (path === "/loop" || path.startsWith("/loop/")) {
    return (
      <Bar label="PRODUCTION" tone="info">
        LOOP is the sized paper book: prior-bar signals, 10 bp per side, sector caps.
      </Bar>
    );
  }
  if (path === "/ema200" || path.startsWith("/ema200/")) {
    return (
      <Bar label="WATCHLIST" tone="warning">
        EMA200 failed the event study. Retracements only. No trade signal.
      </Bar>
    );
  }
  if (path === "/fundamentals" || path.startsWith("/fundamentals")) {
    return (
      <Bar label="FACTORS" tone="info">
        Each input is ranked on its own. Missing inputs stay out of the score, and style weights renormalize.
      </Bar>
    );
  }
  if (RESEARCH.some((href) => path === href || path.startsWith(`${href}/`))) {
    return (
      <Bar label="RESEARCH" tone="warning">
        Not the production book. LOOP is the only sleeve with a costed prior-bar fill. The home capital strip is the combined notional.
      </Bar>
    );
  }
  return null;
}

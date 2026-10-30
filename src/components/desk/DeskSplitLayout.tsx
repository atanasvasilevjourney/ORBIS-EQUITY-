"use client";

import { useEffect } from "react";

export type DeskLayoutMode = "split" | "chart" | "list";

type Props = {
  mode: DeskLayoutMode;
  onModeChange: (mode: DeskLayoutMode) => void;
  listTitle?: string;
  chartTitle?: string;
  list: React.ReactNode;
  chart: React.ReactNode;
  /** Height of the split workspace (list + chart scroll inside). Ignored when `fit` is set. */
  workspaceMinHeight?: number;
  /**
   * Fill the parent instead of a fixed pixel height.
   * Keeps MarketWatch and the chart inside the window at 100% zoom.
   */
  fit?: boolean;
  /** thinkorswim-style layout button labels */
  variant?: "default" | "tos";
};

function ModeButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2 py-1 text-[10px] font-terminal rounded border transition-colors ${
        active
          ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}

export function DeskSplitLayout({
  mode,
  onModeChange,
  listTitle = "WATCHLIST",
  chartTitle = "CHART",
  list,
  chart,
  workspaceMinHeight = 560,
  fit = false,
  variant = "default",
}: Props) {
  const splitLabel = variant === "tos" ? "FLEX" : "SPLIT";
  const listLabel = variant === "tos" ? "LIST" : "LIST";
  const chartLabel = variant === "tos" ? "CHARTS" : "CHART";
  const splitTitle = variant === "tos" ? "MarketWatch + Charts (thinkorswim flex)" : "Watchlist + chart (TC2000 style)";
  useEffect(() => {
    if (mode !== "chart") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onModeChange("split");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onModeChange]);

  const frameClass = fit
    ? "h-full min-h-0 flex-1"
    : "";

  const toolbar = (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-header)] px-3 py-2">
      <span className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest mr-2">LAYOUT</span>
      <ModeButton
        active={mode === "split"}
        label={splitLabel}
        title={splitTitle}
        onClick={() => onModeChange("split")}
      />
      <ModeButton
        active={mode === "list"}
        label={listLabel}
        title="Full-width MarketWatch"
        onClick={() => onModeChange("list")}
      />
      <ModeButton
        active={mode === "chart"}
        label={chartLabel}
        title="Full-screen chart (Esc to exit)"
        onClick={() => onModeChange("chart")}
      />
      {mode === "chart" && (
        <span className="text-[10px] text-[var(--text-muted)] ml-auto">
          Esc · {variant === "tos" ? "FLEX" : "SPLIT"} to restore
        </span>
      )}
    </div>
  );

  if (mode === "chart") {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-[var(--surface)]">
        {toolbar}
        <div className="flex-1 min-h-0 p-2 flex flex-col">{chart}</div>
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div
        className={`flex flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--card-bg)] ${frameClass}`}
        style={fit ? undefined : { minHeight: workspaceMinHeight }}
      >
        {toolbar}
        <div className="shrink-0 border-b border-[var(--border)] px-3 py-1 text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
          {listTitle}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{list}</div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--card-bg)] ${frameClass}`}
      style={fit ? undefined : { minHeight: workspaceMinHeight }}
    >
      {toolbar}
      <div
        className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(16rem,40%)_minmax(0,1fr)] ${
          fit ? "grid-rows-[minmax(0,40%)_minmax(0,1fr)] lg:grid-rows-1" : ""
        }`}
        style={fit ? undefined : { minHeight: workspaceMinHeight - 44 }}
      >
        <div
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-[var(--border)] lg:border-b-0 lg:border-r ${
            fit ? "" : "max-h-[45vh] lg:max-h-none"
          }`}
        >
          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1 text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
            {listTitle}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">{list}</div>
        </div>
        <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${fit ? "" : "min-h-[320px] lg:min-h-0"}`}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1 text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
            <span>{chartTitle}</span>
            <button
              type="button"
              title="Full-screen chart"
              onClick={() => onModeChange("chart")}
              className="px-2 py-0.5 text-[10px] font-terminal rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-info)] hover:text-[var(--accent-info)]"
            >
              ⛶ FULL
            </button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{chart}</div>
        </div>
      </div>
    </div>
  );
}

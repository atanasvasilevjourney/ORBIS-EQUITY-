import type { ReactNode } from "react";

type InfoCalloutProps = {
  title?: string;
  accent?: string;
  variant?: "default" | "warning";
  children: ReactNode;
};

export function InfoCallout({
  title,
  accent = "var(--accent-info)",
  variant = "default",
  children,
}: InfoCalloutProps) {
  const border =
    variant === "warning" ? "rgba(251, 191, 36, 0.35)" : "var(--panel-border)";
  return (
    <div
      className="glass-panel px-4 py-3 mb-4 text-xs text-[var(--text-secondary)] font-terminal leading-relaxed space-y-1.5"
      style={{ borderColor: border }}
    >
      {title && (
        <p className="font-semibold tracking-wider" style={{ color: accent }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

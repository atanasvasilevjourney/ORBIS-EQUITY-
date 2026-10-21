import type { ReactNode } from "react";

type DeskPageHeaderProps = {
  title: string;
  subtitle?: string;
  accent?: string;
  badge?: string;
  children?: ReactNode;
};

export function DeskPageHeader({
  title,
  subtitle,
  accent = "var(--accent-info)",
  badge,
  children,
}: DeskPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {badge && (
          <span
            className="inline-block mb-2 px-2 py-0.5 text-[9px] font-terminal tracking-[0.2em] rounded-full border"
            style={{ borderColor: accent, color: accent }}
          >
            {badge}
          </span>
        )}
        <h1
          className="font-display text-2xl md:text-3xl font-semibold tracking-tight"
          style={{
            background: "var(--gradient-brand)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-[var(--text-secondary)] max-w-2xl">{subtitle}</p>
        )}
      </div>
      {children}
    </header>
  );
}

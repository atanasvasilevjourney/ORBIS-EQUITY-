import type { ReactNode } from "react";

type ModuleHeaderProps = {
  module: string;
  title: string;
  description?: string;
  source?: string;
  accent?: string;
  children?: ReactNode;
};

/** Desk page header — aligned with 2026 glass terminal system. */
export function ModuleHeader({
  module,
  title,
  description,
  source,
  accent = "var(--accent-info)",
  children,
}: ModuleHeaderProps) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span
            className="inline-block mb-2 px-2 py-0.5 text-[9px] font-terminal tracking-[0.2em] rounded-full border"
            style={{ borderColor: accent, color: accent }}
          >
            {module}
          </span>
          <h1 className="font-display text-2xl md:text-[1.75rem] font-semibold tracking-tight leading-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[var(--text-secondary)] mt-1.5 max-w-3xl leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {source && (
          <span className="text-[10px] font-terminal tracking-wider text-[var(--text-muted)] uppercase glass-panel px-3 py-1.5 shrink-0">
            {source}
          </span>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

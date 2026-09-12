import type { ReactNode } from "react";

type ModuleHeaderProps = {
  module: string;
  title: string;
  description?: string;
  source?: string;
  accent?: string;
  children?: ReactNode;
};

/** Shared page header for each module — accent bar + provenance. */
export function ModuleHeader({
  module,
  title,
  description,
  source,
  accent = "var(--accent-info)",
  children,
}: ModuleHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 w-1.5 h-10 rounded-full shrink-0"
            style={{ background: accent }}
            aria-hidden
          />
          <div>
            <div className="text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
              {module}
            </div>
            <h1 className="text-xl font-terminal font-bold tracking-wide">{title}</h1>
            {description && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-2xl">
                {description}
              </p>
            )}
          </div>
        </div>
        {source && (
          <span className="text-[10px] font-terminal tracking-wider text-[var(--text-muted)] uppercase border border-[var(--panel-border)] rounded px-2 py-1">
            {source}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

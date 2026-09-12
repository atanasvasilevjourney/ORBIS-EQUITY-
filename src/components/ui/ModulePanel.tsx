import type { ReactNode } from "react";

type ModulePanelProps = {
  title: string;
  subtitle?: string;
  accent?: string;
  badge?: string;
  source?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Dense equity-signals style panel — thin border, header strip, clear module boundary. */
export function ModulePanel({
  title,
  subtitle,
  accent = "var(--accent-info)",
  badge,
  source,
  actions,
  children,
  className = "",
}: ModulePanelProps) {
  return (
    <section
      className={`flex flex-col rounded border bg-[var(--panel-bg)] overflow-hidden ${className}`}
      style={{ borderColor: "var(--panel-border)" }}
    >
      <header
        className="flex items-center justify-between gap-3 px-3 py-2 border-b"
        style={{
          background: "var(--panel-header)",
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-1 h-4 rounded-full shrink-0"
            style={{ background: accent }}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {badge && (
                <span className="text-[9px] font-terminal tracking-widest text-[var(--text-muted)]">
                  {badge}
                </span>
              )}
              <h2 className="text-xs font-terminal font-semibold tracking-wider truncate">
                {title}
              </h2>
            </div>
            {subtitle && (
              <p className="text-[10px] text-[var(--text-muted)] truncate">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {source && (
            <span className="text-[9px] font-terminal tracking-wider text-[var(--text-muted)] uppercase">
              {source}
            </span>
          )}
          {actions}
        </div>
      </header>
      <div className="flex-1 p-3">{children}</div>
    </section>
  );
}

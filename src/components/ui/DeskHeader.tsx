type Chip = { label: string; color?: string };

type DeskHeaderProps = {
  title: string;
  description?: string;
  asOf?: string | null;
  stale?: boolean;
  lite?: boolean;
  source?: string;
  chips?: Chip[];
};

/** Compact as-of / stale / lite strip for CASH · QUANT · ROTATE. */
export function DeskHeader({
  title,
  description,
  asOf,
  stale,
  lite,
  source,
  chips = [],
}: DeskHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          {title}
        </h1>
        {description ? <p className="text-xs text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-terminal tracking-wider">
        <span className="px-2 py-1 rounded border border-[var(--panel-border)] text-[var(--text-muted)]">
          EOD {asOf ?? "—"}
        </span>
        {source ? (
          <span className="px-2 py-1 rounded border border-[var(--panel-border)] text-[var(--text-muted)]">
            {source}
          </span>
        ) : null}
        {lite ? (
          <span className="px-2 py-1 rounded border border-[var(--panel-border)]" style={{ color: "var(--accent-warning)" }}>
            LITE
          </span>
        ) : null}
        {stale ? (
          <span className="px-2 py-1 rounded border border-[var(--panel-border)] font-bold" style={{ color: "var(--accent-bear)" }}>
            STALE
          </span>
        ) : (
          <span className="px-2 py-1 rounded border border-[var(--panel-border)] text-[var(--text-muted)]">PAPER</span>
        )}
        {chips.map((c) => (
          <span
            key={c.label}
            className="px-2 py-1 rounded border border-[var(--panel-border)]"
            style={{ color: c.color || "var(--text-muted)" }}
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

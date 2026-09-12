type FilterChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

export function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-xs font-terminal rounded border transition-colors ${
        active
          ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
          : "border-[var(--panel-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)]"
      }`}
    >
      {label}
    </button>
  );
}

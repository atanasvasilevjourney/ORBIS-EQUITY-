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
      className={`px-3 py-1 text-[11px] font-terminal rounded-full border transition-all ${
        active
          ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[rgba(56,189,248,0.12)] shadow-[0_0_16px_rgba(56,189,248,0.12)]"
          : "border-[var(--panel-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)]"
      }`}
    >
      {label}
    </button>
  );
}

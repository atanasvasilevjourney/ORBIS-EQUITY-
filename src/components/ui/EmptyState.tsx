type EmptyStateProps = {
  title: string;
  detail?: string;
};

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="px-4 py-10 text-center rounded border border-dashed border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <p className="text-sm font-terminal text-[var(--text-secondary)]">{title}</p>
      {detail && (
        <p className="text-xs text-[var(--text-muted)] mt-2 max-w-md mx-auto">{detail}</p>
      )}
    </div>
  );
}

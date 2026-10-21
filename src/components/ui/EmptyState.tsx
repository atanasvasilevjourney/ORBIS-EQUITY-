type EmptyStateProps = {
  title: string;
  detail?: string;
};

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="glass-panel px-6 py-12 text-center border-dashed">
      <div
        className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center text-lg"
        style={{
          background: "rgba(56, 189, 248, 0.08)",
          boxShadow: "0 0 24px rgba(56, 189, 248, 0.12)",
          color: "var(--accent-info)",
        }}
        aria-hidden
      >
        ◌
      </div>
      <p className="text-sm font-terminal text-[var(--text-secondary)]">{title}</p>
      {detail && (
        <p className="text-xs text-[var(--text-muted)] mt-2 max-w-md mx-auto leading-relaxed">
          {detail}
        </p>
      )}
    </div>
  );
}

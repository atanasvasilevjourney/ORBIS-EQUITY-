"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 py-16 text-center font-terminal">
      <h1 className="text-lg font-bold tracking-wider" style={{ color: "var(--accent-bear)" }}>
        DESK ERROR
      </h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">
        This page hit a client exception. Retry, or open another module from the nav.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 px-4 py-2 text-xs tracking-widest rounded border border-[var(--border)] text-[var(--text-primary)] hover:text-[var(--accent-info)]"
      >
        RETRY
      </button>
    </div>
  );
}

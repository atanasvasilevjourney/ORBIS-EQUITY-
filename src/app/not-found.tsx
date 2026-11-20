import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 px-4 text-center font-terminal">
      <h1 className="text-2xl font-bold tracking-wider mb-2" style={{ color: "var(--accent-info)" }}>
        NOT FOUND
      </h1>
      <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto mb-6">
        That route or ticker is not in the desk universe. Check the symbol or return to the cockpit.
      </p>
      <Link
        href="/"
        className="inline-block text-sm px-4 py-2 rounded border border-[var(--border)] hover:bg-[var(--surface-alt)]"
        style={{ color: "var(--accent-info)" }}
      >
        ← Cockpit
      </Link>
    </div>
  );
}
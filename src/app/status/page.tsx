import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { buildSystemStatus } from "@/lib/systemStatus";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const sb = createServerClient();
  const s = await buildSystemStatus(sb);
  const f = s.freshness;

  return (
    <div className="px-4 py-6 font-terminal text-sm">
      <h1 className="text-lg font-bold tracking-wider mb-2" style={{ color: "var(--accent-info)" }}>
        SYSTEM STATUS
      </h1>
      <p className="text-xs text-[var(--text-secondary)] mb-4">
        EOD delayed tape · NY session {s.nowNy} · expected latest bar ≥ {f.minFreshDate}
      </p>

      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{
          borderColor: f.signalsSuppressed ? "var(--accent-bear)" : "var(--accent-bull)",
          background: "var(--badge-bg)",
        }}
      >
        <div className="text-xs text-[var(--text-muted)] tracking-widest">FRESHNESS GATE</div>
        <div className="mt-1" style={{ color: f.signalsSuppressed ? "var(--accent-bear)" : "var(--accent-bull)" }}>
          {f.signalsSuppressed ? "STALE — BUY/SELL signals suppressed site-wide" : "OK — signals allowed"}
        </div>
        <div className="text-xs text-[var(--text-secondary)] mt-2">
          Prices: {s.pricesAsOf ?? "—"} · Daily brief: {s.dailyBriefAsOf ?? "—"} · LOOP engine: {s.loopAsOf ?? "—"}
        </div>
      </div>

      <h2 className="text-xs text-[var(--text-muted)] tracking-widest mb-2">PIPELINE RUNS (latest per source)</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">SOURCE</th>
              <th className="text-left px-3 py-2">STATUS</th>
              <th className="text-left px-3 py-2">AS OF</th>
              <th className="text-left px-3 py-2">FINISHED</th>
              <th className="text-left px-3 py-2">HEADLINE</th>
            </tr>
          </thead>
          <tbody>
            {s.modules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-[var(--text-muted)]">
                  No <code className="text-[var(--text-primary)]">pipeline_runs</code> rows yet — apply migration 024 and run nightly jobs.
                </td>
              </tr>
            ) : (
              s.modules.map((m) => (
                <tr key={m.source} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 font-bold">{m.source}</td>
                  <td className="px-3 py-2">{m.status}</td>
                  <td className="px-3 py-2">{m.asOfDate ?? "—"}</td>
                  <td className="px-3 py-2">{m.finishedAt?.slice(0, 19) ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-md">{m.headline ?? m.error ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {s.ingestRuns.length > 0 && (
        <>
          <h2 className="text-xs text-[var(--text-muted)] tracking-widest mb-2">INGEST RUNS (legacy log)</h2>
          <ul className="text-xs text-[var(--text-secondary)] mb-6 list-disc pl-5 space-y-1">
            {s.ingestRuns.map((r) => (
              <li key={r.module}>
                {r.module}: {r.asof_date ?? "—"} — {r.headline ?? "—"}
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/" className="text-xs text-[var(--accent-info)] hover:underline">
        ← Back to cockpit
      </Link>
    </div>
  );
}

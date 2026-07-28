"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

type PharmaSignal = {
  id: number;
  ticker: string;
  nctId: string;
  eventType: string;
  direction: string;
  phase: string;
  confidence: number;
  daysToCatalyst: number | null;
  detectedAt: string;
  drugName: string;
  condition: string;
  overallStatus: string;
  leadSponsor: string;
  completionDate: string | null;
  resultsPosted: boolean;
};

type Summary = {
  total: number;
  long: number;
  short: number;
  watch: number;
  upcoming90d: number;
};

function DirectionChip({ direction, confidence }: { direction: string; confidence: number }) {
  const color =
    direction === "LONG"
      ? "var(--accent-bull)"
      : direction === "SHORT"
      ? "var(--accent-bear)"
      : "var(--accent-warning)";
  const arrow = direction === "LONG" ? "\u25B2" : direction === "SHORT" ? "\u25BC" : "\u25CF";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-terminal font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
      }}
    >
      {arrow} {direction} {confidence}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    COMPLETED: "var(--accent-bull)",
    RECRUITING: "var(--accent-info)",
    ACTIVE_NOT_RECRUITING: "var(--accent-info)",
    TERMINATED: "var(--accent-bear)",
    WITHDRAWN: "var(--accent-bear)",
    SUSPENDED: "var(--accent-warning)",
  };
  const color = colorMap[status] ?? "var(--text-muted)";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-terminal"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    TRIAL_FAILURE: "FAILURE",
    RESULTS_POSTED: "RESULTS",
    PENDING_READOUT: "PENDING",
    ACTIVE_TRIAL: "ACTIVE",
  };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--text-muted)] font-terminal">
      {labels[type] ?? type}
    </span>
  );
}

export default function PharmaPage() {
  const [data, setData] = useState<PharmaSignal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [dirFilter, setDirFilter] = useState<"" | "LONG" | "SHORT" | "WATCH">("");
  const [phaseFilter, setPhaseFilter] = useState<"" | "PHASE2" | "PHASE3">("");
  const [eventFilter, setEventFilter] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (dirFilter) params.set("direction", dirFilter);
    if (phaseFilter) params.set("phase", phaseFilter);
    params.set("limit", "500");

    fetch(`/api/pharma?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d.rows ?? []);
        setSummary(d.summary ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dirFilter, phaseFilter]);

  const filtered = useMemo(() => {
    let rows = [...data];
    if (eventFilter) {
      rows = rows.filter((r) => r.eventType === eventFilter);
    }
    return rows;
  }, [data, eventFilter]);

  if (loading) {
    return (
      <div className="px-4 py-12 text-center text-[var(--text-muted)] font-terminal">
        Loading pharma pipeline...
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">PHARMA CATALYST CALENDAR</h1>
      <p className="text-xs text-[var(--text-muted)] mb-4 font-terminal">
        Clinical trial events, PDUFA dates, FDA decisions — Phase 2/3 focus — ClinicalTrials.gov
      </p>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {[
            { label: "TOTAL SIGNALS", value: String(summary.total), color: "" },
            { label: "LONG", value: String(summary.long), color: "var(--accent-bull)" },
            { label: "SHORT", value: String(summary.short), color: "var(--accent-bear)" },
            { label: "WATCH", value: String(summary.watch), color: "var(--accent-warning)" },
            { label: "UPCOMING 90D", value: String(summary.upcoming90d), color: "var(--accent-info)" },
          ].map((c) => (
            <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
              <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
              <div className="text-lg font-terminal font-bold mt-0.5" style={{ color: c.color || undefined }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Direction */}
        {(["", "LONG", "SHORT", "WATCH"] as const).map((d) => (
          <button
            key={d || "all-dir"}
            onClick={() => { setDirFilter(d); setLoading(true); }}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              dirFilter === d
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {d || "ALL"}
          </button>
        ))}

        <span className="border-l border-[var(--border)] mx-1" />

        {/* Phase */}
        {(["", "PHASE2", "PHASE3"] as const).map((p) => (
          <button
            key={p || "all-phase"}
            onClick={() => { setPhaseFilter(p); setLoading(true); }}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              phaseFilter === p
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {p ? p.replace("PHASE", "P") : "ALL PHASES"}
          </button>
        ))}

        <span className="border-l border-[var(--border)] mx-1" />

        {/* Event type */}
        {["", "TRIAL_FAILURE", "RESULTS_POSTED", "PENDING_READOUT", "ACTIVE_TRIAL"].map((e) => (
          <button
            key={e || "all-event"}
            onClick={() => setEventFilter(e)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              eventFilter === e
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {e ? e.replace(/_/g, " ") : "ALL EVENTS"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">DRUG / CATALYST</th>
              <th className="text-left px-3 py-2">CONDITION</th>
              <th className="text-left px-3 py-2">PHASE</th>
              <th className="text-left px-3 py-2">STATUS</th>
              <th className="text-left px-3 py-2">EVENT</th>
              <th className="text-left px-3 py-2">SIGNAL</th>
              <th className="text-right px-3 py-2">DAYS</th>
              <th className="text-left px-3 py-2">COMPLETION</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  No pharma signals match filters. Run pipeline to populate data.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/ticker/${r.ticker}`}
                      className="font-semibold text-[var(--accent-info)] hover:underline"
                    >
                      {r.ticker}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-secondary)] max-w-[200px] truncate" title={r.drugName}>
                    {r.drugName.length > 40 ? r.drugName.slice(0, 40) + "..." : r.drugName}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs max-w-[150px] truncate" title={r.condition}>
                    {r.condition.length > 30 ? r.condition.slice(0, 30) + "..." : r.condition}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--text-secondary)] font-terminal">
                      {r.phase?.replace("PHASE", "P") ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.overallStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <EventTypeBadge type={r.eventType} />
                  </td>
                  <td className="px-3 py-2.5">
                    <DirectionChip direction={r.direction} confidence={r.confidence} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-[var(--text-muted)]">
                    {r.daysToCatalyst != null ? (
                      <span style={{
                        color: r.daysToCatalyst <= 30 ? "var(--accent-warning)" : undefined,
                      }}>
                        {r.daysToCatalyst > 0 ? `${r.daysToCatalyst}d` : r.daysToCatalyst === 0 ? "TODAY" : `${Math.abs(r.daysToCatalyst)}d ago`}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-muted)]">
                    {r.completionDate ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-3 font-terminal">
        Showing {filtered.length} signals. Data from ClinicalTrials.gov v2 API.
      </p>
    </div>
  );
}

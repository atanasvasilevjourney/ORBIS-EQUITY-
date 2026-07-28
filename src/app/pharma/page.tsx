const PLACEHOLDER_CATALYSTS = [
  { date: "JUL 28", type: "PDUFA", ticker: "MRNA", drug: "mRNA-1283 (COVID booster)", phase: "P3", direction: "LONG", confidence: 72 },
  { date: "JUL 30", type: "DATA", ticker: "PFE", drug: "Elranatamab (myeloma)", phase: "P3", direction: "WATCH", confidence: 55 },
  { date: "AUG 02", type: "PDUFA", ticker: "BMRN", drug: "Voxzogo ext.", phase: "P3", direction: "LONG", confidence: 68 },
  { date: "AUG 05", type: "DATA", ticker: "AZN.L", drug: "Dato-DXd NSCLC", phase: "P3", direction: "WATCH", confidence: 60 },
  { date: "AUG 08", type: "TERM", ticker: "SGEN", drug: "Tukysa adjuvant", phase: "P2", direction: "SHORT", confidence: 81 },
];

function DirectionChip({ direction, confidence }: { direction: string; confidence: number }) {
  const color = direction === "LONG" ? "var(--accent-bull)" : direction === "SHORT" ? "var(--accent-bear)" : "var(--accent-warning)";
  const arrow = direction === "LONG" ? "\u25B2" : direction === "SHORT" ? "\u25BC" : "\u25CF";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-terminal font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {arrow} {direction} {confidence}
    </span>
  );
}

export default function PharmaPage() {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">PHARMA CATALYST CALENDAR</h1>
      <p className="text-xs text-[var(--text-muted)] mb-6 font-terminal">
        Clinical trial events, PDUFA dates, FDA decisions — Phase 2/3 focus
      </p>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {["PDUFA", "Phase 3 Readouts", "FDA Decisions", "Terminated", "All"].map((f) => (
          <button key={f} className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
            {f}
          </button>
        ))}
        <span className="border-l border-[var(--border)] mx-1" />
        {["7d", "30d", "90d"].map((f) => (
          <button key={f} className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
            {f}
          </button>
        ))}
      </div>

      {/* Catalyst table */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">DATE</th>
              <th className="text-left px-3 py-2">TYPE</th>
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">CATALYST</th>
              <th className="text-left px-3 py-2">PHASE</th>
              <th className="text-left px-3 py-2">SIGNAL</th>
            </tr>
          </thead>
          <tbody>
            {PLACEHOLDER_CATALYSTS.map((c, i) => (
              <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.date}</td>
                <td className="px-3 py-2.5">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--badge-bg)]">{c.type}</span>
                </td>
                <td className="px-3 py-2.5 font-semibold">{c.ticker}</td>
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.drug}</td>
                <td className="px-3 py-2.5 text-[var(--text-muted)]">{c.phase}</td>
                <td className="px-3 py-2.5">
                  <DirectionChip direction={c.direction} confidence={c.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4 font-terminal">
        Placeholder data. ClinicalTrials.gov + OpenFDA pipeline required.
      </p>
    </div>
  );
}

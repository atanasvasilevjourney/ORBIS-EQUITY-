import { BiasChip } from "@/components/scoreboard/BiasChip";
import { AgreementDots } from "@/components/scoreboard/AgreementDots";

// Placeholder data until pipeline + Supabase are connected
const PLACEHOLDER_ROWS = [
  { symbol: "AAPL", name: "Apple Inc.", state: 1, rank: 78, signals: [true, true, true, true, false], sector: "4/6", price: 227.45, change: 1.2 },
  { symbol: "AZN.L", name: "AstraZeneca PLC", state: 1, rank: 74, signals: [true, true, true, false, false], sector: "4/5", price: 12450, change: 0.8 },
  { symbol: "MSFT", name: "Microsoft Corp", state: -1, rank: 81, signals: [true, true, true, true, true], sector: "5/6", price: 412.1, change: -1.4 },
  { symbol: "ASML.AS", name: "ASML Holding NV", state: 1, rank: 65, signals: [true, true, false, true, false], sector: "3/4", price: 892.3, change: 2.1 },
  { symbol: "PFE", name: "Pfizer Inc.", state: 0, rank: 42, signals: [false, true, false, false, false], sector: "2/6", price: 28.9, change: -0.3 },
];

export default function ScreenerPage() {
  return (
    <div className="px-4 py-6">
      {/* Section summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: "POSTURE", value: "72", sub: "Slight Bull" },
          { label: "BREADTH", value: "58%", sub: "+4pp w/w" },
          { label: "SECTORS", value: "Ind", sub: "Leading" },
          { label: "RATES", value: "4.2%", sub: "10Y +3bp" },
          { label: "VIX", value: "14.2", sub: "-1.3" },
        ].map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-xl font-terminal font-bold mt-1">{c.value}</div>
            <div className="text-xs text-[var(--text-secondary)]">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {["Bull", "Bear", "Neutral", "Flips", "BRK", "Q>=70"].map((f) => (
          <button key={f} className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
            {f}
          </button>
        ))}
        <span className="border-l border-[var(--border)] mx-1" />
        {["US", "UK", "EU", "ALL"].map((f) => (
          <button key={f} className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
            {f}
          </button>
        ))}
        <span className="border-l border-[var(--border)] mx-1" />
        <button className="px-3 py-1 text-xs font-terminal rounded border border-[var(--accent-info)] text-[var(--accent-info)]">
          DAILY
        </button>
        <button className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)]">
          WEEKLY
        </button>
      </div>

      {/* Scoreboard table */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">BIAS</th>
              <th className="text-left px-3 py-2">AGREE</th>
              <th className="text-left px-3 py-2">SECT</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-right px-3 py-2">CHG%</th>
            </tr>
          </thead>
          <tbody>
            {PLACEHOLDER_ROWS.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                <td className="px-3 py-2.5">
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="text-[var(--text-muted)] ml-2 text-xs">{r.name}</span>
                </td>
                <td className="px-3 py-2.5">
                  <BiasChip state={r.state as 1 | 0 | -1} rank={r.rank} />
                </td>
                <td className="px-3 py-2.5">
                  <AgreementDots signals={r.signals} />
                </td>
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">{r.sector}</td>
                <td className="px-3 py-2.5 text-right">{r.price.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right" style={{ color: r.change >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>
                  {r.change >= 0 ? "+" : ""}{r.change}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4 font-terminal">
        Showing placeholder data. Connect Supabase + run pipeline to populate.
      </p>
    </div>
  );
}

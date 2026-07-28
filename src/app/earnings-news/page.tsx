export default function EarningsNewsPage() {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">EARNINGS & NEWS</h1>
      <p className="text-xs text-[var(--text-muted)] mb-6 font-terminal">
        Earnings calendar, post-earnings drift, GDELT news feed with FinBERT sentiment
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Earnings Calendar */}
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-terminal font-semibold tracking-wider">EARNINGS CALENDAR</h2>
          </div>
          <div className="p-4 space-y-3">
            {[
              { ticker: "AAPL", date: "JUL 26", status: "REPORTED", eps: "+0.64", beat: true },
              { ticker: "MSFT", date: "JUL 26", status: "REPORTED", eps: "+0.64", beat: true },
              { ticker: "AMZN", date: "AUG 01", status: "ESTIMATED", eps: "—", beat: null },
              { ticker: "SHEL.L", date: "AUG 03", status: "ESTIMATED", eps: "—", beat: null },
            ].map((e) => (
              <div key={e.ticker} className="flex items-center justify-between text-sm font-terminal py-1 border-b border-[var(--border)] last:border-0">
                <span className="font-semibold w-16">{e.ticker}</span>
                <span className="text-[var(--text-muted)] w-16">{e.date}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${e.status === "REPORTED" ? "bg-[var(--badge-bg)]" : "bg-[var(--surface-alt)]"}`}>
                  {e.status}
                </span>
                <span className="w-12 text-right" style={{ color: e.beat ? "var(--accent-bull)" : "var(--text-muted)" }}>
                  {e.eps}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* News Feed */}
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-terminal font-semibold tracking-wider">NEWS FEED</h2>
          </div>
          <div className="p-4 space-y-3">
            {[
              { headline: "Apple reports Q3 earnings beat, services revenue hits record", tone: 0.72, time: "2h ago", ticker: "AAPL" },
              { headline: "AstraZeneca Dato-DXd Phase 3 trial shows mixed results in NSCLC", tone: -0.15, time: "5h ago", ticker: "AZN.L" },
              { headline: "Fed holds rates steady, signals September cut likely", tone: 0.31, time: "8h ago", ticker: "MACRO" },
            ].map((n, i) => (
              <div key={i} className="text-sm py-2 border-b border-[var(--border)] last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-terminal font-semibold" style={{ color: "var(--accent-info)" }}>{n.ticker}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{n.time}</span>
                  <span
                    className="text-[10px] px-1 rounded"
                    style={{
                      color: n.tone > 0.2 ? "var(--accent-bull)" : n.tone < -0.1 ? "var(--accent-bear)" : "var(--text-muted)",
                      backgroundColor: "var(--badge-bg)",
                    }}
                  >
                    {n.tone > 0 ? "+" : ""}{n.tone.toFixed(2)}
                  </span>
                </div>
                <p className="text-[var(--text-secondary)] text-xs leading-relaxed">{n.headline}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4 font-terminal">
        Placeholder data. GDELT + FinBERT + LSE earnings pipeline required.
      </p>
    </div>
  );
}

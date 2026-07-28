export default function FundamentalsPage() {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">FUNDAMENTALS & VALUATION</h1>
      <p className="text-xs text-[var(--text-muted)] mb-6 font-terminal">
        1,472 stocks — 50+ metrics from LSE Screener API — US, UK, EU, Global
      </p>

      {/* Fundamental screener placeholder */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              {["TICKER", "P/E", "P/B", "EV/EBITDA", "ROE", "MARGIN", "D/E", "GROWTH", "DIV%", "F-SCORE"].map(h => (
                <th key={h} className="text-left px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { sym: "AAPL", pe: 29.4, pb: 47.2, ev: 22.1, roe: 147.3, margin: 26.4, de: 1.8, growth: 8.2, div: 0.5, f: 7 },
              { sym: "AZN.L", pe: 24.4, pb: 6.8, ev: 16.3, roe: 28.1, margin: 18.7, de: 0.9, growth: 12.4, div: 2.1, f: 6 },
              { sym: "ASML.AS", pe: 39.1, pb: 22.4, ev: 30.5, roe: 57.2, margin: 33.1, de: 0.4, growth: 22.8, div: 0.7, f: 8 },
            ].map(r => (
              <tr key={r.sym} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                <td className="px-3 py-2.5 font-semibold">{r.sym}</td>
                <td className="px-3 py-2.5">{r.pe}</td>
                <td className="px-3 py-2.5">{r.pb}</td>
                <td className="px-3 py-2.5">{r.ev}</td>
                <td className="px-3 py-2.5">{r.roe}%</td>
                <td className="px-3 py-2.5">{r.margin}%</td>
                <td className="px-3 py-2.5">{r.de}</td>
                <td className="px-3 py-2.5" style={{ color: "var(--accent-bull)" }}>+{r.growth}%</td>
                <td className="px-3 py-2.5">{r.div}%</td>
                <td className="px-3 py-2.5">{r.f}/9</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4 font-terminal">
        Placeholder data. LSE Screener API data populates on pipeline run.
      </p>
    </div>
  );
}

import Link from "next/link";

export default function Home() {
  const modules = [
    {
      href: "/screener",
      title: "SWING SCREENER",
      desc: "Momentum & technical bias board — bull/bear swing candidates with convergence scoring",
      badge: "MODULE 1",
    },
    {
      href: "/fundamentals",
      title: "FUNDAMENTALS & VALUATION",
      desc: "Financial statements, ratios, DCF, quality scores — 1,472 global stocks",
      badge: "MODULE 2",
    },
    {
      href: "/pharma",
      title: "PHARMA PIPELINE",
      desc: "Clinical trial catalyst calendar, PDUFA dates, Phase 2/3 signals — long/short",
      badge: "MODULE 3",
    },
    {
      href: "/earnings-news",
      title: "EARNINGS & NEWS",
      desc: "Earnings calendar, post-earnings drift, GDELT news feed with sentiment",
      badge: "MODULE 4",
    },
  ];

  return (
    <div className="px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-terminal font-bold tracking-wider mb-2" style={{ color: "var(--accent-info)" }}>
          KOVAVIEW TERMINAL
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Equity Swing Terminal — Free Data, Honest Signals, Global Coverage
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        {modules.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="block p-6 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] hover:border-[var(--accent-info)] transition-colors group"
          >
            <span className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">
              {m.badge}
            </span>
            <h2 className="text-lg font-terminal font-semibold mt-1 mb-2 group-hover:text-[var(--accent-info)] transition-colors">
              {m.title}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addHolding,
  applyFrontier,
  buildSnapshot,
  compareSleeves,
  diagnose,
  equalize,
  fixSum,
  frontierAtVol,
  projectMonteCarlo,
  rebalanceHolding,
  removeHolding,
  sampleFrontier,
  sleeveHoldings,
  SLEEVES,
  WINDOWS,
  type Holding,
  type SleeveId,
  type WindowId,
} from "@/lib/portfolio/engine";
import { CASH, DEFAULT_HOLDINGS, FLAGS, UNIVERSE, assetBySymbol } from "@/lib/portfolio/universe";
import {
  CalendarChart,
  CorrGrid,
  Donut,
  DrawdownChart,
  FactorBars,
  FanChart,
  FrontierChart,
  GrowthChart,
  HBars,
  HistChart,
  MonthHeat,
  RollingChart,
  ScatterChart,
  Spark,
  StackedWeights,
  Treemap,
} from "@/components/portfolio/charts";
import { num, pct, tone, usd } from "@/components/portfolio/format";
import { ActiveTrading } from "@/components/portfolio/ActiveTrading";

const STORE = "orbis-portfolio-studio-v1";

type Mode = "simple" | "pro";

export function PortfolioStudio() {
  const [mode, setMode] = useState<Mode>("simple");
  const [windowId, setWindowId] = useState<WindowId>("5Y");
  const [holdings, setHoldings] = useState<Holding[]>(DEFAULT_HOLDINGS);
  const [sleeve, setSleeve] = useState<SleeveId>("hold");
  const [frontierSeed, setFrontierSeed] = useState(7);
  const [targetVol, setTargetVol] = useState<number | null>(null);
  const [mcYears, setMcYears] = useState<5 | 10 | 20>(10);
  const [mcSeed, setMcSeed] = useState(42);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<[string, string] | null>(null);
  const [ready, setReady] = useState(false);
  const [lagged, setLagged] = useState(holdings);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as {
          mode?: Mode;
          windowId?: WindowId;
          holdings?: Holding[];
          sleeve?: SleeveId;
        };
        const book = sanitize(saved.holdings);
        if (book) setHoldings(book);
        if (saved.mode === "pro" || saved.mode === "simple") setMode(saved.mode);
        if (WINDOWS.some((w) => w.id === saved.windowId)) setWindowId(saved.windowId as WindowId);
        if (SLEEVES.some((s) => s.id === saved.sleeve)) setSleeve(saved.sleeve as SleeveId);
      }
    } catch {
      /* keep the starter book */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORE, JSON.stringify({ mode, windowId, holdings, sleeve }));
  }, [ready, mode, windowId, holdings, sleeve]);

  const snap = useMemo(() => buildSnapshot(holdings, windowId), [holdings, windowId]);
  useEffect(() => {
    const t = setTimeout(() => setLagged(holdings), 140);
    return () => clearTimeout(t);
  }, [holdings]);
  const cloud = useMemo(() => sampleFrontier(lagged, windowId, frontierSeed), [lagged, windowId, frontierSeed]);
  const mc = useMemo(
    () => projectMonteCarlo(buildSnapshot(lagged, windowId).daily, mcYears, mcSeed),
    [lagged, windowId, mcYears, mcSeed],
  );
  const sleeveStats = useMemo(() => compareSleeves(lagged, windowId), [lagged, windowId]);
  const signals = useMemo(() => diagnose(holdings, sleeve), [holdings, sleeve]);
  const picked = useMemo(() => frontierAtVol(cloud, targetVol ?? snap.you.vol), [cloud, targetVol, snap.you.vol]);

  const equityCount = holdings.filter((h) => h.symbol !== CASH).length;
  const suggestions = UNIVERSE.filter((a) => !holdings.some((h) => h.symbol === a.symbol)).slice(0, 8);
  const matches = query.trim()
    ? UNIVERSE.filter((a) => {
        const q = query.trim().toLowerCase();
        return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  const openPro = () => {
    setMode("pro");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const arm = (id: SleeveId) => {
    setSleeve(id);
    if (id === "hold") return;
    setHoldings(id === "equal" ? equalize(holdings) : sleeveHoldings(holdings, id));
  };

  const slide = (symbol: string, weight: number) => {
    setSleeve("hold");
    setHoldings(rebalanceHolding(holdings, symbol, weight));
  };

  if (!ready) {
    return (
      <div className="pf-shell pt-6">
        <p className="pf-kicker">Orbis · Portfolio</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight mt-1">Portfolio Studio</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Opening the book…</p>
      </div>
    );
  }

  const pro = mode === "pro";
  const sleeveMeta = SLEEVES.find((s) => s.id === sleeve)!;
  const pair = pinned && snap.corr.symbols.length
    ? snap.corr.matrix[snap.corr.symbols.indexOf(pinned[0])]?.[snap.corr.symbols.indexOf(pinned[1])]
    : null;

  return (
    <div className="pf-shell space-y-4 pt-2">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pf-kicker">Orbis · Portfolio</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight mt-1">Portfolio Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {pro
              ? "Systematic sleeves rewrite the long-term mix. Active Trading lists the open short-term paper books beside that mix. The quant stack still reads the sliders."
              : "Pick stocks, set the mix, and leave it alone. This book is built for multi-year compounding."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-[var(--panel-border)] bg-[var(--surface-alt)] p-1">
            <button type="button" className="pf-mode" data-active={mode === "simple"} onClick={() => setMode("simple")}>
              Simple
            </button>
            <button type="button" className="pf-mode" data-active={mode === "pro"} onClick={openPro}>
              Pro
            </button>
          </div>
          <span className="pf-pill border border-[var(--panel-border)]">Base · USD</span>
          <span className="pf-pill border border-[var(--panel-border)]">vs World proxy</span>
        </div>
      </header>

      {pro && (
        <section className="pf-card" id="pf-sleeves">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Systematic sleeve</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1 max-w-3xl">
                Arm a rule and it writes the latest rebalance into the sliders. The return under each rule is that rule, rebalanced monthly on these names. Manual is today’s mix, held constant.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
            {SLEEVES.map((s) => {
              const stat = sleeveStats.find((r) => r.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => arm(s.id)}
                  className="rounded-xl border px-2.5 py-2 text-left"
                  style={{
                    borderColor: sleeve === s.id ? "#3b82f6" : "var(--panel-border)",
                    background: sleeve === s.id ? "rgba(59,130,246,0.12)" : "transparent",
                  }}
                >
                  <p className="text-[12px] font-medium">{s.label}</p>
                  <p className={`font-terminal text-sm ${tone(stat?.total ?? 0)}`}>{pct(stat?.total ?? 0)}</p>
                  {stat && <Spark values={stat.spark} color={stat.total >= 0 ? "#22c55e" : "#fb7185"} />}
                </button>
              );
            })}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[var(--text-muted)] font-terminal">
                <tr>
                  <th className="py-1 pr-3 font-normal">Name</th>
                  <th className="py-1 pr-3 font-normal">12-1</th>
                  <th className="py-1 pr-3 font-normal">Vol</th>
                  <th className="py-1 pr-3 font-normal">Beta</th>
                  <th className="py-1 pr-3 font-normal">Quality</th>
                  <th className="py-1 pr-3 font-normal">Weight</th>
                  <th className="py-1 font-normal">Tape</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.symbol} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3 font-medium">{s.symbol}</td>
                    <td className={`py-1.5 pr-3 font-terminal ${tone(s.momentum)}`}>{s.symbol === CASH ? "—" : pct(s.momentum)}</td>
                    <td className="py-1.5 pr-3 font-terminal">{s.symbol === CASH ? "—" : pct(s.vol, 1, false)}</td>
                    <td className="py-1.5 pr-3 font-terminal">{s.symbol === CASH ? "—" : num(s.beta)}</td>
                    <td className="py-1.5 pr-3 font-terminal">{s.symbol === CASH ? "—" : s.quality.toFixed(0)}</td>
                    <td className="py-1.5 pr-3 font-terminal">{s.weight.toFixed(1)}%</td>
                    <td className="py-1.5 text-[var(--text-secondary)]">{s.action === "CASH" ? "Cash" : s.action === "LINE" ? "In line" : s.action === "OVERWEIGHT" ? "Overweight" : "Underweight"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pro && <ActiveTrading />}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)] gap-4">
        <section className="pf-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{pro ? "Long-term basket" : "Your basket"}</h2>
            <div className="inline-flex rounded-full bg-[var(--surface-alt)] p-1">
              <button type="button" className="pf-pill" data-active={sleeve === "hold"} onClick={() => arm("hold")}>Manual</button>
              <button type="button" className="pf-pill" data-active={sleeve === "equal"} onClick={() => arm("equal")}>Equal</button>
              <button type="button" className="pf-pill" data-active={sleeve === "invvol"} onClick={() => arm("invvol")}>Inverse-vol</button>
            </div>
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {equityCount}/12 stocks · {sleeveMeta.blurb}
          </p>
          <ul className="mt-4 space-y-3">
            {holdings.map((h) => {
              const asset = h.symbol === CASH ? null : assetBySymbol(h.symbol);
              const color = h.symbol === CASH ? "#6b7280" : asset?.color ?? "#60a5fa";
              return (
                <li key={h.symbol}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                        {h.symbol}
                      </div>
                      <p className="pl-4 text-[11px] text-[var(--text-muted)] truncate">
                        {h.symbol === CASH ? "3.5% yield · not a risk asset" : `${asset?.name} · ${asset?.sector}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`${h.symbol} weight`}
                        className="pf-input"
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={h.weight}
                        onChange={(e) => slide(h.symbol, Number(e.target.value))}
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">%</span>
                      <button
                        type="button"
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1"
                        aria-label={`Remove ${h.symbol}`}
                        onClick={() => {
                          setSleeve("hold");
                          setHoldings(removeHolding(holdings, h.symbol));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <input
                    className="pf-range mt-2"
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={h.weight}
                    aria-label={`${h.symbol} slider`}
                    style={{ ["--c" as string]: color, ["--p" as string]: `${h.weight}%` }}
                    onChange={(e) => slide(h.symbol, Number(e.target.value))}
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-3 h-2 rounded-full bg-[var(--track)] overflow-hidden">
            <div className="h-full w-full bg-[var(--accent-bull)]" />
          </div>
          <p className="mt-1 text-[12px] text-[var(--accent-bull)]">Fully allocated · 100%</p>

          <div className="mt-4">
            <label className="pf-kicker" htmlFor="pf-search">Add a stock</label>
            <input
              id="pf-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a name or ticker"
              className="mt-1 w-full rounded-full border border-[var(--panel-border)] bg-[var(--surface-alt)] px-4 py-2 text-sm outline-none focus:border-[var(--accent-info)]"
            />
            {query.trim() && (
              <ul className="mt-2 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-alt)] overflow-hidden">
                {matches.length === 0 && (
                  <li className="px-3 py-2 text-[12px] text-[var(--text-muted)]">That name is outside the studio universe.</li>
                )}
                {matches.map((a) => {
                  const inBook = holdings.some((h) => h.symbol === a.symbol);
                  return (
                    <li key={a.symbol}>
                      <button
                        type="button"
                        disabled={inBook || equityCount >= 12}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--card-bg)] disabled:opacity-40"
                        onClick={() => {
                          setSleeve("hold");
                          setHoldings(addHolding(holdings, a.symbol, 5));
                          setQuery("");
                        }}
                      >
                        <span><span className="font-terminal">{a.symbol}</span> · {a.name}</span>
                        <span className="text-[11px] text-[var(--text-muted)]">{a.countryCode} · {a.sector.split(" ")[0]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((a) => (
                <button
                  key={a.symbol}
                  type="button"
                  className="chip-link"
                  disabled={equityCount >= 12}
                  onClick={() => {
                    setSleeve("hold");
                    setHoldings(addHolding(holdings, a.symbol, 5));
                  }}
                >
                  + {a.symbol}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              onClick={() => {
                setHoldings(DEFAULT_HOLDINGS);
                setSleeve("hold");
              }}
            >
              Reset basket
            </button>
          </div>
        </section>

        <aside className="pf-card h-fit xl:sticky xl:top-20">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live metrics</h2>
            <span className="pf-kicker">{windowId}</span>
          </div>
          <dl className="mt-3 divide-y divide-[var(--border)]">
            <Metric label="Historical return" value={pct(snap.kpis.annReturn)} className={tone(snap.kpis.annReturn)} />
            <Metric label="Volatility" value={pct(snap.kpis.vol, 1, false)} />
            <Metric label="Sharpe ratio" value={num(snap.kpis.sharpe)} />
            <Metric label="Max drawdown" value={pct(snap.kpis.maxDd)} className="text-[var(--accent-bear)]" />
            <Metric label="1d VaR 95" value={pct(snap.kpis.var95)} className="text-[var(--accent-bear)]" />
            <Metric label="Portfolio beta" value={num(snap.kpis.beta)} />
            <Metric label="Diversification" value={`${snap.kpis.divScore}/100`} />
          </dl>
          <div className="mt-4 flex items-center gap-3">
            <Ring rows={snap.weights} />
            <div>
              <p className="text-2xl font-semibold">{num(snap.kpis.effectiveN, 1)}</p>
              <p className="text-[11px] text-[var(--text-muted)]">Effective holdings · 1 / Σw²</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-[#3b82f6] py-2.5 text-sm font-semibold text-white hover:bg-[#2563eb]"
            onClick={() => document.getElementById("pf-analytics")?.scrollIntoView({ behavior: "smooth" })}
          >
            Analyze this portfolio →
          </button>
        </aside>
      </div>

      <section className="pf-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">What’s driving risk and return</h2>
          <span className="pf-kicker">attribution</span>
        </div>
        <div className="mt-3 grid grid-cols-[88px_1fr_1fr] gap-3 text-[10px] font-terminal text-[var(--text-muted)]">
          <span>Line</span>
          <span>Return contribution</span>
          <span>Risk contribution</span>
        </div>
        <div className="mt-1 space-y-2">
          {snap.contribution.filter((c) => Math.abs(c.retShare) >= 0.005 || c.riskShare >= 0.005).map((c) => (
            <div key={c.symbol} className="grid grid-cols-[88px_1fr_1fr] gap-3 items-center text-[12px]">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.symbol}
              </span>
              <ShareBar value={c.retShare} />
              <ShareBar value={c.riskShare} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Return contribution is weight × each line’s CAGR, scaled to 100. Risk contribution is that line’s share of variance. A name can be a small slice of the money and a large slice of the risk.
        </p>
      </section>

      <div id="pf-analytics" className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div>
          <h2 className="font-display text-2xl font-semibold">Analytics</h2>
          <p className="text-[12px] text-[var(--text-muted)]">
            {snap.window.start} → {snap.window.end} · {snap.window.days} sessions · today’s weights, daily rebalanced
          </p>
        </div>
        <div className="inline-flex rounded-full bg-[var(--surface-alt)] p-1">
          {WINDOWS.map((w) => (
            <button key={w.id} type="button" className="pf-pill" data-active={windowId === w.id} onClick={() => setWindowId(w.id)}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#1d4ed8]/40 bg-[#1e3a8a]/30 px-4 py-2.5 text-sm text-[#dbeafe]">
        Largest line is {snap.largest.symbol} at {snap.largest.weight.toFixed(1)}%.{" "}
        {snap.topCountry.weight >= 55
          ? `${snap.topCountry.label} is ${snap.topCountry.weight.toFixed(0)}% of the book — concentrated.`
          : `${snap.topCountry.label} leads geography at ${snap.topCountry.weight.toFixed(0)}%.`}
      </div>

      <Card title="Portfolio weights" hint="Cash earns 3.5%. Equity weights are the risk budget.">
        <StackedWeights rows={snap.weights} />
      </Card>

      <Card title="Portfolio KPIs" hint="Same window as the growth chart. Sharpe uses a 2% risk-free rate.">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Kpi label="Value of $10,000" value={usd(snap.kpis.value)} className={tone(snap.kpis.value - 10000)} />
          <Kpi label="Historical return" value={pct(snap.kpis.annReturn)} className={tone(snap.kpis.annReturn)} />
          <Kpi label="Volatility" value={pct(snap.kpis.vol, 1, false)} />
          <Kpi label="Beta" value={num(snap.kpis.beta)} />
          <Kpi label="Max drawdown" value={pct(snap.kpis.maxDd)} className="text-[var(--accent-bear)]" />
          <Kpi label="Diversification" value={`${snap.kpis.divScore}/100`} />
        </div>
      </Card>

      <Card title="Growth of $10,000" hint="Blue is your mix. The dashed line is the world proxy.">
        <GrowthChart points={snap.growth} />
        <div className="mt-2 flex gap-4 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-[#3b82f6]" /> Your portfolio</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 border-t border-dashed border-[#94a3b8]" /> World proxy</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Asset allocation" hint="Sector mix of the whole book, cash included.">
          <Donut slices={snap.allocation.map((s) => ({ label: s.label, weight: s.weight, color: s.color }))} />
        </Card>
        <Card title="Largest positions" hint="Single names, weighted by the slider. No look-through overlap.">
          <ol className="divide-y divide-[var(--border)]">
            {snap.names.slice(0, 6).map((n) => (
              <li key={n.symbol} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="font-medium">{n.name}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{n.symbol} · {n.via}</p>
                </div>
                <span className="font-terminal">{n.weight.toFixed(1)}%</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="flex items-end justify-between gap-3 pt-2">
        <div>
          <h2 className="font-display text-2xl font-semibold">Quant stack</h2>
          <p className="text-[12px] text-[var(--text-muted)] max-w-2xl">
            {pro
              ? "Correlation, factors, tails, frontier, and scenario replay. All of them use the basket above."
              : "These modules stay locked in Simple. Pro is the systematic desk — same book, full risk read."}
          </p>
        </div>
        {!pro && (
          <button type="button" className="rounded-full bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white" onClick={openPro}>
            Unlock Pro
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Correlation matrix" hint="Click a pair to pin the read." locked={!pro} onUnlock={openPro}>
          <CorrGrid symbols={snap.corr.symbols} matrix={snap.corr.matrix} pinned={pinned} onPin={setPinned} />
          <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
            {pair != null && pinned
              ? `${pinned[0]} × ${pinned[1]}  ${pair.toFixed(2)}. ${pair > 0.85 ? "That is close to the same bet twice." : "They share a market factor, and still have their own residual."}`
              : "Click any pair to pin its read."}
          </p>
        </Card>
        <Card title="Currency exposure" hint="Cash counts as US dollars." locked={!pro} onUnlock={openPro}>
          <HBars rows={snap.currencies.filter((c) => c.weight >= 0.5).map((c) => ({ label: c.label, value: c.weight, color: "#3b82f6" }))} />
        </Card>
        <Card title="Geographic exposure" hint="Country of the company, not the listing venue." locked={!pro} onUnlock={openPro}>
          <HBars
            rows={snap.countries.filter((c) => c.weight >= 0.5).map((c) => ({
              label: c.label,
              value: c.weight,
              flag: FLAGS[c.flag] ?? "",
              color: c.label === "Cash" ? "#6b7280" : "#3b82f6",
            }))}
          />
        </Card>
        <Card title="True sector exposure" hint="Invested book only. Cash is left out so the tiles sum to 100." locked={!pro} onUnlock={openPro}>
          <Treemap slices={snap.sectors} />
        </Card>
        <Card title="Factor exposure" hint="Fama-French five plus momentum, monthly language on daily data." locked={!pro} onUnlock={openPro}>
          <FactorBars rows={snap.factors} />
          <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
            Alpha {pct(snap.factorMeta.alpha)} · t {num(snap.factorMeta.alphaT, 1)} · R² {num(snap.factorMeta.r2)} · {snap.factorMeta.months} months
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Alpha is what is left after market, size, value, profitability, investment, and momentum. A big market beta is not alpha.
          </p>
        </Card>
        <Card title="Rolling volatility" hint="Annualized, 126-session window, full sample." locked={!pro} onUnlock={openPro}>
          <RollingChart points={snap.rolling} />
          {snap.rolling.length > 0 && (
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Latest {pct(snap.rolling[snap.rolling.length - 1].vol, 1, false)} · {snap.rolling[snap.rolling.length - 1].date}
            </p>
          )}
        </Card>
        <Card title="Calendar returns" hint="Compounded years. Gray is the world proxy, color is the book." locked={!pro} onUnlock={openPro}>
          <CalendarChart rows={snap.calendar} />
        </Card>
        <Card title="Monthly returns" hint="Approximate months of the selected window. Empty cells were outside it." locked={!pro} onUnlock={openPro}>
          <MonthHeat rows={snap.months} />
        </Card>
        <Card title="Return distribution" hint="Daily simple returns. The dashed line is the 5% historical VaR." locked={!pro} onUnlock={openPro}>
          <HistChart dist={snap.distribution} />
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
            <Mini label="Skew" value={num(snap.distribution.skew)} />
            <Mini label="Ex. kurt" value={num(snap.distribution.exKurt)} />
            <Mini label="Best day" value={pct(snap.distribution.best)} className="text-[var(--accent-bull)]" />
            <Mini label="Worst day" value={pct(snap.distribution.worst)} className="text-[var(--accent-bear)]" />
            <Mini label="Up days" value={pct(snap.distribution.up, 0, false)} />
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            VaR {pct(snap.distribution.var95)} · CVaR {pct(snap.distribution.cvar)}. CVaR is the average of the days that landed in the tail.
          </p>
        </Card>
        <Card title="Portfolio drawdown" hint="Depth below the running peak of the daily-rebalanced path." locked={!pro} onUnlock={openPro}>
          <DrawdownChart points={snap.drawdown} />
          <ul className="mt-3 space-y-1.5 text-[12px]">
            {snap.episodes.map((e) => (
              <li key={`${e.start}-${e.end}`} className="flex justify-between gap-3 border-t border-[var(--border)] py-1.5">
                <span className="text-[var(--text-secondary)]">{e.start} → {e.end}</span>
                <span className="font-terminal text-[var(--accent-bear)]">{pct(e.depth)} · {e.days}d</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Risk vs return" hint="Each name against the book and the world proxy. Up and to the left is the comfortable corner. History, not a forecast." locked={!pro} onUnlock={openPro}>
          <ScatterChart points={snap.scatter} you={snap.you} world={snap.world} />
        </Card>
        <Card title="Efficient frontier" hint="Long-only mixes of this basket, sampled from the same window. Illustrative." locked={!pro} onUnlock={openPro}>
          <FrontierChart cloud={cloud} you={snap.you} picked={picked} />
          {cloud.length > 0 && picked && (
            <div className="mt-3 space-y-2">
              <label className="flex items-center justify-between text-[12px] text-[var(--text-secondary)]">
                <span>Target volatility</span>
                <span className="font-terminal">{pct(picked.vol, 1, false)} · {pct(picked.ret)} · Sharpe {num(picked.sharpe)}</span>
              </label>
              <input
                className="pf-range"
                type="range"
                min={Math.min(...cloud.map((p) => p.vol))}
                max={Math.max(...cloud.map((p) => p.vol))}
                step={0.001}
                value={picked.vol}
                aria-label="Target volatility"
                style={{ ["--c" as string]: "#f59e0b", ["--p" as string]: "50%" }}
                onChange={(e) => setTargetVol(Number(e.target.value))}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-full bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white" onClick={() => setFrontierSeed((n) => n + 1)}>
                  Recalculate
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--panel-border)] px-3 py-1.5 text-xs"
                  onClick={() => {
                    setSleeve("hold");
                    setHoldings(applyFrontier(holdings, picked.weights));
                  }}
                >
                  Use this mix
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Recalculate draws a new cloud. Use this mix writes the nearest sample into the sliders and drops you back to a manual book. Cash weight stays.
              </p>
            </div>
          )}
        </Card>
        <Card title="Monte Carlo projection" hint="Bootstrap of this window’s daily returns. The fan is a range of histories, not a promise." locked={!pro} onUnlock={openPro}>
          <div className="mb-2 inline-flex rounded-full bg-[var(--surface-alt)] p-1">
            {([5, 10, 20] as const).map((y) => (
              <button key={y} type="button" className="pf-pill" data-active={mcYears === y} onClick={() => setMcYears(y)}>{y}y</button>
            ))}
            <button type="button" className="pf-pill" onClick={() => setMcSeed((n) => n + 1)}>New seed</button>
          </div>
          <FanChart mc={mc} />
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
            <Mini label="P5" value={usd(mc.p5)} className="text-[var(--accent-bear)]" />
            <Mini label="Median" value={usd(mc.median)} />
            <Mini label="P95" value={usd(mc.p95)} className="text-[var(--accent-bull)]" />
            <Mini label="Mean" value={usd(mc.mean)} />
            <Mini label="Contributed" value={usd(mc.contributed)} className={tone(mc.contributed)} />
          </div>
        </Card>
        <Card title="Scenario replay" hint="Today’s weights, walked through three scripted regimes on the shared path." locked={!pro} onUnlock={openPro}>
          <ul className="space-y-4">
            {snap.scenarios.map((s) => (
              <li key={s.id} className="border-t border-[var(--border)] pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{s.range}</p>
                  </div>
                  <div className="text-right">
                    <Spark values={s.path} />
                    <p className="font-terminal text-[var(--accent-bear)]">{pct(s.total)}</p>
                  </div>
                </div>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{s.note} Worst day {pct(s.worstDay)}.</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="pb-6 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Studio history is one seeded factor path from January 2020 through October 2026, with scripted regimes for the COVID crash, the 2022 rate selloff, and spring 2025. Every module shares that path, so the sliders move the whole page together. It is a decision surface for learning the book, not a broker statement, not advice, and not a forecast.
      </p>
    </div>
  );
}

function Card({
  title,
  hint,
  locked,
  onUnlock,
  children,
}: {
  title: string;
  hint?: string;
  locked?: boolean;
  onUnlock?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="pf-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p>}
        </div>
        {locked && <span className="pf-pill border border-[var(--panel-border)]">Pro</span>}
      </div>
      <div className="relative">
        <div className={locked ? "pointer-events-none select-none blur-[2px] opacity-55" : undefined}>{children}</div>
        {locked && (
          <button type="button" onClick={onUnlock} className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white shadow-lg">Unlock in Pro</span>
          </button>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="pf-kicker">{label}</dt>
      <dd className={`font-terminal text-sm ${className ?? ""}`}>{value}</dd>
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-alt)] px-3 py-3">
      <p className="pf-kicker">{label}</p>
      <p className={`mt-1 text-xl font-semibold font-terminal ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-alt)] px-2 py-2">
      <p className="pf-kicker">{label}</p>
      <p className={`font-terminal text-sm ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function ShareBar({ value }: { value: number }) {
  const width = Math.min(100, Math.round(Math.abs(value) * 1000) / 10);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-[var(--track)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${width.toFixed(1)}%`, background: value >= 0 ? "#22c55e" : "#ef4444" }}
        />
      </div>
      <span className="w-12 text-right font-terminal text-[11px]">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

function Ring({ rows }: { rows: { weight: number; color: string }[] }) {
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  let acc = 0;
  const stops = rows.map((r) => {
    const start = acc;
    acc += (r.weight / total) * 100;
    return `${r.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
  });
  return (
    <div className="relative h-16 w-16 shrink-0" aria-hidden>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${stops.join(",")})` }} />
      <div className="absolute inset-[7px] rounded-full" style={{ background: "var(--panel-bg)" }} />
    </div>
  );
}

function sanitize(raw: unknown): Holding[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows: Holding[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const symbol = String((row as Holding).symbol ?? "");
    const weight = Number((row as Holding).weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return null;
    if (symbol !== CASH && !assetBySymbol(symbol)) return null;
    rows.push({ symbol, weight });
  }
  if (!rows.some((r) => r.symbol !== CASH)) return null;
  return fixSum(rows);
}

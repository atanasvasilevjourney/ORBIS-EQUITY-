# thinkorswim-style trade workspace

ORBIS EQUITY does not replicate thinkorswim order entry, options chains, or multi-monitor layouts. The **`/trade`** route mirrors the **MarketWatch + Charts** workflow:

| TOS concept | ORBIS route | Notes |
|-------------|-------------|--------|
| MarketWatch | Left pane (`MARKETWATCH`) | Same Trend Radar scan as `/screener` |
| Charts | Right pane (`CHARTS`) | lightweight-charts, 1d / 5m, EMA ribbon |
| Quote / OHLC | `TosQuoteStrip` | Last, day %, rel vol; crosshair O/H/L/C/vol |
| Flex grid | LAYOUT → **FLEX** | Split list + chart; LIST / CHARTS full pane |
| Keyboard | ↑↓ symbol, **D** daily, **5** 5m | Disabled while typing in inputs |

**`/screener`** keeps the TC2000-style labels (SPLIT / CHART) without the quote strip or keyboard shortcuts.

Implementation: `WatchlistChartsWorkspace` (`variant="tos" | "tc2000"`), `ChartPane` + `TradingChart.onCrosshairBar`, `useWatchlistKeyboard`.

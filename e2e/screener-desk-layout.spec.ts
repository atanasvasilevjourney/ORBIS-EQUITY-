import { test, expect } from "@playwright/test";

const MOCK_CANDLES = Array.from({ length: 24 }, (_, i) => {
  const base = 50 + i * 0.3;
  return {
    time: `2024-02-${String(i + 1).padStart(2, "0")}`,
    open: base,
    high: base + 1.5,
    low: base - 0.8,
    close: base + 0.4,
    volume: 800_000,
  };
});

function mockScreenerRow(
  symbol: string,
  companyName: string,
  sector: string,
  rank: number,
  dayPct: number
) {
  return {
    symbol,
    companyName,
    sector,
    country: "US",
    state: 1 as const,
    rank,
    zMom: dayPct,
    fEwmac: 2,
    z52: -0.5,
    breakout: true,
    volumeConfirmed: true,
    convergence: 2,
    stateChangedAt: null,
    dayPct,
    relVolume: 2.1,
    pctFromHigh: -1.2,
    price: 42.5,
    marketCap: 1e9,
    peRatio: 18,
    orbisScore: 80,
    hasTrendRadar: true,
  };
}

const SCREENER_ROWS = [
  mockScreenerRow("AAA", "Alpha Corp", "Tech", 12, 5.2),
  mockScreenerRow("BBB", "Beta Inc", "Health", 28, 4.1),
];

test("screener desk layout: split, list, fullscreen chart", async ({ page }) => {
  await page.route("**/api/screener*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SCREENER_ROWS),
    });
  });

  await page.route("**/api/summary*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOfDate: "2024-02-24",
        briefText: null,
        posture: 62,
        postureLabel: "Neutral",
        breadth: { total: 2, greens: 2, reds: 0, pctGreen: 100, pctRed: 0 },
        avgRank: 20,
        bestSector: "Tech",
        worstSector: "Health",
      }),
    });
  });

  await page.route("**/api/chart/AAA*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        interval: "1d",
        source: "prices_daily",
        candles: MOCK_CANDLES,
        sma20: MOCK_CANDLES.map((_, i) => (i >= 19 ? 55 : null)),
      }),
    });
  });

  await page.route("**/api/chart/BBB*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        interval: "1d",
        source: "prices_daily",
        candles: MOCK_CANDLES,
        sma20: MOCK_CANDLES.map((_, i) => (i >= 19 ? 55 : null)),
      }),
    });
  });

  await page.goto("/screener");
  const layoutBar = page.locator("div").filter({ hasText: "LAYOUT" }).first();
  await expect(layoutBar.getByRole("button", { name: "SPLIT", exact: true })).toBeVisible();
  await expect(page.getByText("WATCHLIST · SCAN")).toBeVisible();

  await page.locator("tbody tr").filter({ hasText: "BBB" }).click();
  await expect(page.getByText(/selected BBB/)).toBeVisible();
  await expect(page.locator("a").filter({ hasText: "BBB" }).first()).toBeVisible();

  await layoutBar.getByRole("button", { name: "LIST", exact: true }).click();
  await expect(page.getByText("WATCHLIST · SCAN")).toBeVisible();
  await expect(page.getByText("CHART · EMA RIBBON")).toHaveCount(0);

  await layoutBar.getByRole("button", { name: "CHART", exact: true }).click();
  await expect(page.getByText("Esc · SPLIT to restore")).toBeVisible();
  const chartPane = page.locator(".tv-lightweight-charts").first();
  await expect(chartPane).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Escape");
  await expect(page.getByText("Esc · SPLIT to restore")).toHaveCount(0);
  await expect(layoutBar.getByRole("button", { name: "SPLIT", exact: true })).toBeVisible();
});

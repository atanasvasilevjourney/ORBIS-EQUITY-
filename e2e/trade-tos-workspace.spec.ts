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

function mockScreenerRow(symbol: string, companyName: string) {
  return {
    symbol,
    companyName,
    sector: "Tech",
    country: "US",
    state: 1 as const,
    rank: 12,
    zMom: 5.2,
    fEwmac: 2,
    z52: -0.5,
    breakout: true,
    volumeConfirmed: true,
    convergence: 2,
    stateChangedAt: null,
    dayPct: 5.2,
    relVolume: 2.1,
    pctFromHigh: -1.2,
    price: 42.5,
    marketCap: 1e9,
    peRatio: 18,
    orbisScore: 80,
    hasTrendRadar: true,
  };
}

const ROWS = [mockScreenerRow("AAA", "Alpha Corp"), mockScreenerRow("BBB", "Beta Inc")];

test("trade desk: TOS flex layout, quote strip, keyboard nav", async ({ page }) => {
  await page.route("**/api/screener*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ROWS),
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

  for (const sym of ["AAA", "BBB"]) {
    await page.route(`**/api/chart/${sym}*`, async (route) => {
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
  }

  await page.goto("/trade");
  const layoutBar = page.locator("div").filter({ hasText: "LAYOUT" }).first();
  await expect(layoutBar.getByRole("button", { name: "FLEX", exact: true })).toBeVisible();
  await expect(page.getByText("MARKETWATCH", { exact: true })).toBeVisible();
  await expect(page.getByText("AAA").first()).toBeVisible();
  await expect(page.getByText(/Last 42\.50/)).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByText(/selected BBB/)).toBeVisible();

  await layoutBar.getByRole("button", { name: "CHARTS", exact: true }).click();
  await expect(page.getByText("Esc · FLEX to restore")).toBeVisible();
  await expect(page.locator(".tv-lightweight-charts").first()).toBeVisible({ timeout: 15_000 });
});

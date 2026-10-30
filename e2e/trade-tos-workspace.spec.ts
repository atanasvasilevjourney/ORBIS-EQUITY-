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

  async function expectFitsViewport(label: string) {
    await expect(page.getByRole("link", { name: "AAA", exact: true }).first()).toBeInViewport();
    const chart = page.locator(".tv-lightweight-charts").first();
    await expect(chart).toBeVisible({ timeout: 15_000 });
    await expect(chart).toBeInViewport();
    const fit = await page.evaluate(() => {
      const main = document.querySelector("main");
      const doc = document.documentElement;
      const canvas = document.querySelector(".tv-lightweight-charts canvas") as HTMLCanvasElement | null;
      const ticker = document.querySelector("tbody a");
      const tickerBox = ticker?.getBoundingClientRect();
      const canvasBox = canvas?.getBoundingClientRect();
      return {
        docX: doc.scrollWidth - doc.clientWidth,
        docY: doc.scrollHeight - doc.clientHeight,
        mainX: main ? main.scrollWidth - main.clientWidth : 0,
        mainY: main ? main.scrollHeight - main.clientHeight : 0,
        cssW: canvasBox?.width ?? 0,
        cssH: canvasBox?.height ?? 0,
        bufW: canvas?.width ?? 0,
        bufH: canvas?.height ?? 0,
        dpr: window.devicePixelRatio,
        tickerLeft: tickerBox?.left ?? -1,
        tickerRight: tickerBox?.right ?? -1,
        innerWidth: window.innerWidth,
      };
    });
    expect(fit.docX, `${label} document width`).toBeLessThanOrEqual(1);
    expect(fit.docY, `${label} document height`).toBeLessThanOrEqual(1);
    expect(fit.mainX, `${label} main width`).toBeLessThanOrEqual(1);
    expect(fit.mainY, `${label} main height`).toBeLessThanOrEqual(1);
    expect(fit.cssH, `${label} chart height`).toBeGreaterThan(160);
    expect(fit.cssW, `${label} chart width`).toBeGreaterThan(200);
    expect(fit.tickerLeft, `${label} ticker`).toBeGreaterThanOrEqual(0);
    expect(fit.tickerRight, `${label} ticker`).toBeLessThanOrEqual(fit.innerWidth);
    const dpr = fit.dpr || 1;
    expect(Math.abs(fit.bufW / dpr - fit.cssW), `${label} canvas width`).toBeLessThan(3);
    expect(Math.abs(fit.bufH / dpr - fit.cssH), `${label} canvas height`).toBeLessThan(3);
    await page.screenshot({ path: `/opt/cursor/artifacts/trade-${label}.png` });
  }

  await expectFitsViewport("1280");
  await page.setViewportSize({ width: 1366, height: 768 });
  await expectFitsViewport("1366");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectFitsViewport("1920");

  await page.keyboard.press("ArrowDown");
  await expect(page.getByText(/selected BBB/)).toBeVisible();

  await layoutBar.getByRole("button", { name: "CHARTS", exact: true }).click();
  await expect(page.getByText("Esc · FLEX to restore")).toBeVisible();
  await expect(page.locator(".tv-lightweight-charts").first()).toBeVisible({ timeout: 15_000 });
});

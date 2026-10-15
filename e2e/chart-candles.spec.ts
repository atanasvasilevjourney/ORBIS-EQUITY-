import { test, expect } from "@playwright/test";

const MOCK_CANDLES = Array.from({ length: 30 }, (_, i) => {
  const base = 100 + i * 0.5;
  return {
    time: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: base,
    high: base + 2,
    low: base - 1,
    close: base + 1,
    volume: 1_000_000,
  };
});

/**
 * Daily Bias chart must render candlesticks (TradingView watermark canvas),
 * not an empty black pane with only the header row.
 */
test("ticker chart renders candlestick canvas", async ({ page }) => {
  await page.route("**/api/ticker/A", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        radar: null,
        fundamentals: null,
        universe: { symbol: "A", company_name: "Agilent", sector: "Health", exchange: "NYSE", tier: "A", country: "US" },
        earnings: [],
        insiderTrades: [],
      }),
    });
  });
  await page.route("**/api/chart/A*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        interval: "1d",
        source: "prices_daily",
        candles: MOCK_CANDLES,
        sma20: MOCK_CANDLES.map((_, i) => (i >= 19 ? 105 : null)),
      }),
    });
  });
  await page.route("**/api/earnings-news*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: { upcoming: 0 } }) });
  });
  await page.route("**/api/bias", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ names: [] }) });
  });

  await page.goto("/ticker/A");
  await expect(page.getByText(/Loading A\.\.\./)).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "CHART" })).toBeVisible();
  await expect(page.getByText(/A · 1d · prices_daily/)).toBeVisible({ timeout: 30_000 });

  const chartPane = page.locator(".tv-lightweight-charts").first();
  await expect(chartPane).toBeVisible({ timeout: 15_000 });

  const box = await chartPane.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  const canvas = chartPane.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox!.width).toBeGreaterThan(50);
  expect(canvasBox!.height).toBeGreaterThan(50);

  const pixel = await page.evaluate(({ w, h }) => {
    const c = document.querySelector(".tv-lightweight-charts canvas") as HTMLCanvasElement | null;
    if (!c) return { ok: false, reason: "no canvas" };
    const ctx = c.getContext("2d");
    if (!ctx) return { ok: false, reason: "no ctx" };
    const sx = Math.floor(w / 2);
    const sy = Math.floor(h / 2);
    const d = ctx.getImageData(sx, sy, 1, 1).data;
    const lum = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    return { ok: lum > 8 && lum < 250, lum, rgb: [d[0], d[1], d[2]] };
  }, { w: canvasBox!.width, h: canvasBox!.height });
  expect(pixel.ok, `chart canvas looked blank (rgb=${pixel.rgb}, lum=${pixel.lum})`).toBe(true);
});

import { test, expect } from "@playwright/test";

/**
 * Daily Bias chart must render candlesticks (TradingView watermark canvas),
 * not an empty black pane with only the header row.
 */
test("ticker chart renders candlestick canvas", async ({ page }) => {
  await page.goto("/ticker/A");
  await page.getByRole("button", { name: "CHART" }).click();
  await expect(page.getByText(/Daily Bias · 1d · prices_daily/)).toBeVisible({ timeout: 30_000 });

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

  const pixel = await page.evaluate(({ x, y, w, h }) => {
    const c = document.querySelector(".tv-lightweight-charts canvas") as HTMLCanvasElement | null;
    if (!c) return { ok: false, reason: "no canvas" };
    const ctx = c.getContext("2d");
    if (!ctx) return { ok: false, reason: "no ctx" };
    const sx = Math.floor(w / 2);
    const sy = Math.floor(h / 2);
    const d = ctx.getImageData(sx, sy, 1, 1).data;
    const lum = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    return { ok: lum > 8 && lum < 250, lum, rgb: [d[0], d[1], d[2]] };
  }, { x: box!.x, y: box!.y, w: canvasBox!.width, h: canvasBox!.height });
  expect(pixel.ok, `chart canvas looked blank (rgb=${pixel.rgb}, lum=${pixel.lum})`).toBe(true);
});

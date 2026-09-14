import { test, expect } from "@playwright/test";

const ERROR_JSON = { error: "Internal server error" };

test("SKEW / ANALYZE / ORB stay up when APIs return 500 JSON", async ({ page }) => {
  const overlay = page.getByText("Application error: a client-side exception has occurred");
  const crashes: string[] = [];
  page.on("pageerror", (err) => crashes.push(err.message));

  await page.route("**/api/skew", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(ERROR_JSON) });
  });
  await page.route("**/api/analysis", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(ERROR_JSON) });
  });
  await page.route("**/api/orb", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(ERROR_JSON) });
  });

  await page.goto("/skew");
  await expect(page.getByText("SKEW MAP")).toBeVisible();
  await expect(page.getByText("No skew snapshot")).toBeVisible();
  await expect(overlay).toHaveCount(0);

  await page.goto("/analysis");
  await expect(page.getByText("STOCK ANALYSIS")).toBeVisible();
  await expect(page.getByText("No analysis snapshot")).toBeVisible();
  await expect(overlay).toHaveCount(0);

  await page.goto("/orb");
  await expect(page.getByText("OPENING RANGE BREAKOUT")).toBeVisible();
  await expect(page.getByText("No ≥4% gappers this session")).toBeVisible();
  await expect(overlay).toHaveCount(0);

  expect(crashes, crashes.join("\n")).toEqual([]);
});

import { expect, test } from "@playwright/test";

/** Paper and research desks that the core smoke list does not open. */
const PAPER_DESKS = [
  "/loop",
  "/orb",
  "/cash",
  "/skew",
  "/analysis",
  "/bias",
  "/quantropy",
  "/rotate",
  "/status",
];

for (const path of PAPER_DESKS) {
  test(`paper desk ${path} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("xs sleeve shows the relative-strength reason", async ({ page }) => {
  await page.route("**/api/loop", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          equity: 100000,
          deployedPct: 0.2,
          openRiskPct: 0.02,
          names: 1,
          lastLoopRunAt: "2026-10-26T21:00:00Z",
          asOfDate: "2026-10-26",
          runId: "loop-1",
          status: "ok",
          posture: 60,
        },
        book: [],
        orders: [],
        harness: { sectorExposure: [], skipped: [], config: { maxNames: 8 } },
        log: [],
        headline: "donchian",
        stale: false,
        journal: [],
        journalSummary: { closedTrades: 0, realizedPnlUsd: 0, winRatePct: null },
        strategy: {
          donchianVwap: { asOf: "2026-10-26", knownOn: "2026-10-26", entryCandidates: [], exitHints: [] },
        },
        xs: {
          summary: {
            equity: 100000,
            deployedPct: 0.25,
            names: 1,
            asOfDate: "2026-10-26",
            runId: "xs-1",
            lastRunAt: "2026-10-26T21:05:00Z",
            headline: "XS book",
          },
          book: [
            {
              ticker: "NVDA",
              companyName: "NVIDIA",
              shares: 5,
              entry: 100,
              last: 110,
              sector: "Technology",
              reason: "XS rank 70 · RS 88 · watch",
              rank: 70,
              unrealizedPnlUsd: 50,
              daysHeld: 3,
              openedAt: "2026-10-26",
            },
          ],
          harness: { config: { rsLookback: 63, rsCoverage: 12 } },
        },
      }),
    });
  });

  await page.goto("/loop");
  const xs = page.getByRole("button", { name: "XS Watchlist" });
  await expect(xs).toBeEnabled();
  await xs.click();
  await expect(page.getByRole("link", { name: "NVDA" })).toBeVisible();
  await expect(page.getByText("Technology")).toBeVisible();
  await expect(page.getByText("XS rank 70 · RS 88 · watch")).toBeVisible();
  await expect(page.getByText(/63\s*-session relative strength/)).toBeVisible();
  if (process.env.WALKTHROUGH_SHOT) {
    await page.screenshot({ path: process.env.WALKTHROUGH_SHOT, fullPage: true });
  }
});

test("loop sleeve toggle stays on the page", async ({ page }) => {
  await page.goto("/loop");
  const xs = page.getByRole("button", { name: "XS Watchlist" });
  await expect(xs).toBeVisible();
  await page.getByRole("button", { name: "Donchian 55" }).click();
  await expect(page).toHaveURL(/\/loop/);
  await expect(page.getByRole("heading", { name: "Open book" })).toBeVisible();
  if (await xs.isEnabled()) {
    await xs.click();
    await expect(page).toHaveURL(/\/loop/);
    await expect(page.getByText("XS SLEEVE")).toBeVisible();
  }
});

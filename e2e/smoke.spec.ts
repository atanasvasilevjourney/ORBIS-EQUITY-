import { test, expect } from "@playwright/test";

/** Core routes exercised in smoke (primary nav + a few module desks). */
const PAGES = ["/", "/trade", "/screener", "/loop", "/fundamentals", "/health", "/earnings-news"];
/** Linked from fundamentals module or MORE menu, not all in the top pill row. */
const EXTRA_SMOKE_PAGES = ["/fundamentals/screener", "/triangle", "/ema200"];
/** Primary nav pills (desktop); traversed in order in the nav walk test. */
const PRIMARY_NAV_PAGES = ["/trade", "/screener", "/loop", "/fundamentals"];

for (const path of [...PAGES, ...EXTRA_SMOKE_PAGES]) {
  test(`page ${path} loads without error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(500);

    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();

    expect(errors).toEqual([]);
  });
}

test("nav links traverse all dashboard pages", async ({ page }) => {
  // Wide enough for the desktop pill nav. Secondary desks live under MORE.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");

  for (const path of PRIMARY_NAV_PAGES) {
    const pattern = new RegExp(`${path.replace("/", "\\/")}(\\?|$)`);
    await expect(async () => {
      const link = page.locator(`nav a[href="${path}"]`).first();
      if (!(await link.isVisible())) {
        await page.getByRole("button", { name: /MORE/ }).click();
      }
      await expect(link).toBeVisible();
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(pattern);
    }).toPass({ timeout: 15_000 });
  }
});

test("theme toggle switches label", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();
  const before = await toggle.textContent();
  await toggle.click();
  const after = await toggle.textContent();
  expect(before).not.toBe(after);
});

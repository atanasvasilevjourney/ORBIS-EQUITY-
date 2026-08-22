import { test, expect } from "@playwright/test";

const PAGES = ["/", "/screener", "/fundamentals", "/pharma", "/earnings-news"];

for (const path of PAGES) {
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
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  for (const path of PAGES.slice(1)) {
    const link = page.locator(`nav a[href="${path}"]`);
    await expect(link.first()).toBeVisible();
    await link.first().click();
    await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
  }
});

test("theme toggle switches label", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /PAPER|NEON/ });
  await expect(toggle).toBeVisible();
  const before = await toggle.textContent();
  await toggle.click();
  const after = await toggle.textContent();
  expect(before).not.toBe(after);
});

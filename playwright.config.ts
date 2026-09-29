import { defineConfig, devices } from "@playwright/test";

/** Dedicated port so we never attach to a stale non-Next listener on :3000. */
const E2E_PORT = process.env.PLAYWRIGHT_PORT ?? "3002";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;

const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useExternalServer
    ? undefined
    : process.env.CI
      ? {
          command: `PORT=${E2E_PORT} npm run start`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 180_000,
        }
      : {
          command: `PORT=${E2E_PORT} npm run dev`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 180_000,
        },
});

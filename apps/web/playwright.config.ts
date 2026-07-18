import { defineConfig, devices } from "@playwright/test";

/**
 * Critical-flow end-to-end tests for the Golden Key staff portal.
 *
 * Runs against a production build (`next start`) on a fixed port. Locally,
 * point AFLO_CHROMIUM_PATH at a preinstalled Chromium; in CI, `playwright
 * install chromium` provides the bundled browser and the override is unset.
 */
const PORT = 3222;
const chromiumPath = process.env.AFLO_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm start",
    url: `http://localhost:${PORT}`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

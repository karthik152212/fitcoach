import { defineConfig, devices } from "@playwright/test";

/**
 * FitCoach end-to-end tests.
 *
 * The suite boots the Vite dev server and serves recorded `/v0` responses via
 * Playwright routing (see apps/web/e2e/fixtures/api.ts), so it needs no
 * PostgreSQL and no API process. Every assertion therefore tests the real
 * web app — routing, session storage, set logging, responsive shell — against
 * the real request contracts.
 */

const PORT = 4319;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -w @fitcoach/web -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

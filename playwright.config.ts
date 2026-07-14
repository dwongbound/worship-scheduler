// E2E config. Prereq: the test db must be running —
//   docker compose --profile test up -d db-test
// Then: npm run test:e2e
// (Or run the whole suite in docker: docker compose --profile test up.)
//
// global-setup resets + reseeds the db, and the webServer block boots the
// app on port 3100 with env/test.env automatically.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Tests share one database, so run serially to keep state predictable.
  fullyParallel: false,
  workers: 1,
  // A couple of specs are occasionally flaky under container load (a slow
  // generate/render can blow the default 30s test timeout). Retry rather than
  // fail the whole suite on a transient miss; a genuinely broken test still
  // fails all its attempts.
  retries: 2,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

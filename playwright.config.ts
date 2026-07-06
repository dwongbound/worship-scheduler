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
  retries: 0,
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

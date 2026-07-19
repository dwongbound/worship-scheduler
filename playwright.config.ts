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
  // Two viewports, two projects. `mobile.spec.ts` is the phone-width pass over
  // the app's responsive branches (bottom tab bar, the My-sets list that
  // replaces the month grid, the desktop-only .ics export); every other spec is
  // written against the desktop layout, so each project runs only its own half
  // rather than the whole suite twice. Pixel 5 is a real device preset — mobile
  // user-agent, touch, and DPR — not just a narrow window, so it also exercises
  // the touch-only paths a bare viewport override would miss.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

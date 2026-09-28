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
  // The e2e server is `next dev` (JIT), so the FIRST request to a route compiles
  // it on demand — occasionally pushing a first-touch content assertion past the
  // 5s default even on a healthy run. Give assertions more headroom so a cold
  // compile doesn't read as a failure (a genuinely-missing element still fails
  // after the timeout).
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  // Projects by layout. `mobile.spec.ts` is the phone-width pass and
  // `tablet.spec.ts` the md–lg one; every other spec is written against the
  // desktop layout. testMatch/testIgnore keep each project to its own slice
  // rather than running the whole suite on every device.
  //
  // Mobile runs on two real device presets — newest iOS (iPhone 16 Pro) and
  // newest Samsung flagship (Galaxy S24) — so the phone paths are exercised
  // under both engines' user-agent, touch, and DPR, not just a narrow window.
  // Update these two names to bump to a newer preset when Playwright ships one.
  //
  // Tablet mirrors that, with one wrinkle: every Android tablet preset
  // Playwright ships is NARROWER than 768px (Galaxy Tab S4 is 712), which puts
  // it in the phone layout and tests nothing this file is for. So the second
  // tablet is that preset's engine, touch and DPR with a viewport set into the
  // band by hand. The iPad preset needs no such help.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /(mobile|tablet)\.spec\.ts/,
    },
    {
      name: "mobile-ios",
      use: { ...devices["iPhone 16 Pro"] },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      name: "mobile-android",
      use: { ...devices["Galaxy S24"] },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      name: "tablet-ipad",
      // 810×1080 — inside the md–lg band in portrait, WebKit, touch.
      use: { ...devices["iPad (gen 7)"] },
      testMatch: /tablet\.spec\.ts/,
    },
    {
      name: "tablet-android",
      // Chromium engine + touch from the tablet preset, but widened to 820 so
      // it lands in the band the file is about (the preset's own 712 is phone
      // territory — see the note above).
      use: {
        ...devices["Galaxy Tab S4"],
        viewport: { width: 820, height: 1180 },
      },
      testMatch: /tablet\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

// Unit tests only — pure business logic in lib/. E2E lives in playwright.
import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

// Project runs as ESM ("type": "module"), so `__dirname` isn't defined here —
// derive it from this config's URL.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // Make a bare `npm run test:unit` match CI on any machine:
    // - TZ: recurring availability and every date in a chat message are read
    //   on the app's clock (America/Los_Angeles), so the date cases assume it.
    // - DATABASE_URL: lib/prisma.ts refuses to build a client without one, and
    //   importing any route or notifier builds it. Unit tests never connect
    //   (prisma is mocked or unused), so a placeholder is enough; a real one
    //   from the shell or env file still wins.
    env: {
      TZ: "America/Los_Angeles",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://unit:unit@localhost:5432/unit",
    },
  },
  resolve: {
    // Mirror the "@/..." alias from tsconfig.json.
    alias: { "@": rootDir },
  },
});

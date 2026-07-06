// Unit tests only — pure business logic in lib/. E2E lives in playwright.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // Mirror the "@/..." alias from tsconfig.json.
    alias: { "@": path.resolve(__dirname) },
  },
});

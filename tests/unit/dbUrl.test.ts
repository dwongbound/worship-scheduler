// Unit tests for lib/dbUrl.normalizeDatabaseUrl — the pg sslmode alias fix.
import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "@/lib/dbUrl";

describe("normalizeDatabaseUrl", () => {
  it("spells out sslmode=require as verify-full", () => {
    const out = normalizeDatabaseUrl(
      "postgresql://u:p@host.neon.tech/db?sslmode=require&channel_binding=require"
    );
    expect(new URL(out).searchParams.get("sslmode")).toBe("verify-full");
    // Everything else about the URL survives.
    expect(new URL(out).searchParams.get("channel_binding")).toBe("require");
    expect(new URL(out).host).toBe("host.neon.tech");
  });

  it("rewrites the other aliased modes too", () => {
    for (const mode of ["prefer", "verify-ca"]) {
      const out = normalizeDatabaseUrl(`postgresql://u:p@host/db?sslmode=${mode}`);
      expect(new URL(out).searchParams.get("sslmode")).toBe("verify-full");
    }
  });

  it("leaves a URL with no sslmode alone (local docker postgres)", () => {
    const url = "postgresql://worship:worship@db-dev:5432/worship";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("leaves already-explicit modes alone", () => {
    for (const mode of ["verify-full", "disable", "no-verify"]) {
      const url = `postgresql://u:p@host/db?sslmode=${mode}`;
      expect(normalizeDatabaseUrl(url)).toBe(url);
    }
  });

  it("respects a deliberate libpq-compat opt-in", () => {
    const url = "postgresql://u:p@host/db?uselibpqcompat=true&sslmode=require";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  it("passes through anything it can't parse", () => {
    expect(normalizeDatabaseUrl("not a url")).toBe("not a url");
  });
});

// Unit tests for lib/urlParam — how a page writes a modal's identity into the
// address bar and clears it again.
//
// These are SOURCE tests, not behaviour tests, and deliberately so. The defect
// they guard (`router.replace` to the pathname already on screen being thrown
// away, so a `?set=` link's modal can never be closed) reproduces ONLY in a
// production build: under `next dev` the same call clears the param and closes
// the modal. The e2e suite runs `next dev`, so an e2e assertion about closing a
// linked set passes on the broken code — which is exactly how this reached
// prod. Reading the source is the one check that fails on any machine, in CI or
// not, without building and serving the app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceUrl } from "@/lib/urlParam";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Pages that write a search param of their own, and the param each writes. */
const PARAM_WRITERS = [
  ["app/calendar/page.tsx", "?set= and ?draft="],
  ["app/create/page.tsx", "?draft="],
  ["app/users/page.tsx", "?user="],
  ["app/login/page.tsx", "?nameConflict= and ?conflicts="],
] as const;

describe("replaceUrl", () => {
  it("changes the URL through the history API, never a router navigation", () => {
    // These run in vitest's node environment, so there is no `window` until
    // one is installed — which is also the server case replaceUrl guards.
    const calls: unknown[][] = [];
    const g = globalThis as { window?: unknown };
    g.window = { history: { replaceState: (...a: unknown[]) => calls.push(a) } };
    try {
      replaceUrl("/calendar?set=abc");
    } finally {
      delete g.window;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]).toBe("/calendar?set=abc");
  });

  it("does nothing on the server, where there is no history to write", () => {
    expect(() => replaceUrl("/calendar")).not.toThrow();
  });
});

describe("every page that writes its own search param", () => {
  it.each(PARAM_WRITERS)(
    "%s does it through replaceUrl, not the router (%s)",
    (file) => {
      const src = read(file);
      expect(src).toContain('from "@/lib/urlParam"');
      // A router navigation to this page's OWN pathname is the bug: in a
      // production build Next drops it, so the param never changes and
      // `useSearchParams` never hears about it. Anything genuinely going to
      // ANOTHER path (login's `router.push(callbackUrl)`) is fine and is not
      // matched here.
      const samePathNav =
        /router\.(replace|push)\(\s*(`\$\{pathname\}|pathname\b|["'`]\/(?:calendar|create|users|login)\b)/;
      expect(src).not.toMatch(samePathNav);
    }
  );
});

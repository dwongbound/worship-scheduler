// The one width behind "is this the app-style layout?". Three separate things
// read it — the bottom nav's `lg:` classes, the tab-swipe pager, and
// pull-to-refresh — so the boundary itself is worth pinning down.
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_MAX_WIDTH, isBottomNavWidth } from "@/lib/layout";
import {
  CALENDAR_WINDOW_AHEAD_DAYS,
  SETS_WINDOW_MAX_DAYS,
} from "@/lib/constants";

const atWidth = (width: number) =>
  vi.stubGlobal("window", { innerWidth: width });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isBottomNavWidth", () => {
  it("matches Tailwind's lg, so the classes and the gestures agree", () => {
    // 1024 = `lg`. If this moves, the `lg:hidden` / `lg:flex` pairs that go
    // with it have to move too — which is the whole reason it lives in one
    // place (see lib/layout.ts).
    expect(BOTTOM_NAV_MAX_WIDTH).toBe(1024);
  });

  it("is true below the breakpoint and false at it", () => {
    atWidth(BOTTOM_NAV_MAX_WIDTH - 1);
    expect(isBottomNavWidth()).toBe(true);

    // Exactly at the breakpoint is DESKTOP: `lg:` applies at min-width 1024,
    // so an off-by-one here would put the bottom bar and the top strip on
    // screen together.
    atWidth(BOTTOM_NAV_MAX_WIDTH);
    expect(isBottomNavWidth()).toBe(false);

    atWidth(BOTTOM_NAV_MAX_WIDTH + 400);
    expect(isBottomNavWidth()).toBe(false);
  });

  it("calls a phone a phone", () => {
    atWidth(390); // iPhone
    expect(isBottomNavWidth()).toBe(true);
    atWidth(820); // iPad portrait
    expect(isBottomNavWidth()).toBe(true);
  });
});

describe("the calendar's opening window", () => {
  it("fits inside what the endpoint will serve", () => {
    // The calendar asks for this much ahead plus the days already on screen;
    // the endpoint refuses anything wider than SETS_WINDOW_MAX_DAYS, so the
    // opening fetch must leave room for the back edge and for paging.
    expect(CALENDAR_WINDOW_AHEAD_DAYS).toBeLessThan(SETS_WINDOW_MAX_DAYS);
  });

  it("is three months, the horizon the UI promises", () => {
    expect(CALENDAR_WINDOW_AHEAD_DAYS).toBe(92);
  });
});

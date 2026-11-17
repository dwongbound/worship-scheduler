import { describe, expect, it } from "vitest";
import {
  MENU_GUTTER,
  placeMenu,
  type Rect,
} from "@/lib/dropdownPosition";

// A trigger box from its top-left corner and size, the way a real one measures.
function trigger(left: number, top: number, width = 32, height = 32): Rect {
  return { left, top, right: left + width, bottom: top + height };
}

// A roomy desktop window, and a phone.
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

describe("horizontal placement", () => {
  it("hangs a right-aligned panel off the trigger's right edge", () => {
    const { left } = placeMenu({
      trigger: trigger(900, 100),
      menu: { width: 224, height: 180 },
      viewport: DESKTOP,
    });
    // 900 + 32 = 932, minus the panel's own width.
    expect(left).toBe(932 - 224);
  });

  it("hangs a left-aligned panel off the trigger's left edge", () => {
    const { left } = placeMenu({
      trigger: trigger(900, 100),
      menu: { width: 224, height: 180 },
      viewport: DESKTOP,
      align: "left",
    });
    expect(left).toBe(900);
  });

  it("keeps a right-aligned panel on screen when the trigger sits near the left", () => {
    // The set detail modal's "⋮" on a phone: the action bar had wrapped, so the
    // trigger ended up ~136px in, and 136 - 224 put the panel's first letters
    // off the side of the screen.
    const { left } = placeMenu({
      trigger: trigger(104, 300),
      menu: { width: 224, height: 180 },
      viewport: PHONE,
    });
    expect(left).toBe(MENU_GUTTER);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it("keeps a left-aligned panel on screen when the trigger sits near the right", () => {
    const { left } = placeMenu({
      trigger: trigger(340, 300),
      menu: { width: 224, height: 180 },
      viewport: PHONE,
      align: "left",
    });
    expect(left).toBe(PHONE.width - 224 - MENU_GUTTER);
    expect(left + 224).toBeLessThanOrEqual(PHONE.width);
  });

  it("pins a panel wider than the screen to the left gutter", () => {
    // Overflowing rightward keeps the first characters of every row, which are
    // the ones worth reading; clamping the other way would hide them.
    const { left } = placeMenu({
      trigger: trigger(200, 300),
      menu: { width: 500, height: 180 },
      viewport: PHONE,
    });
    expect(left).toBe(MENU_GUTTER);
  });

  it("honours a custom gutter", () => {
    const { left } = placeMenu({
      trigger: trigger(10, 300),
      menu: { width: 224, height: 180 },
      viewport: PHONE,
      gutter: 24,
    });
    expect(left).toBe(24);
  });
});

describe("vertical placement", () => {
  it("opens below the trigger when there is room", () => {
    const { top, above, maxHeight } = placeMenu({
      trigger: trigger(900, 100),
      menu: { width: 224, height: 180 },
      viewport: DESKTOP,
    });
    expect(top).toBe(132);
    expect(above).toBe(false);
    // A panel that fits is never given a scroll box.
    expect(maxHeight).toBeUndefined();
  });

  it("flips above the trigger when there is no room below", () => {
    // 60px left under the trigger, 700 above it.
    const { top, above, maxHeight } = placeMenu({
      trigger: trigger(900, 700),
      menu: { width: 224, height: 180 },
      viewport: { width: 1280, height: 792 },
    });
    expect(above).toBe(true);
    expect(top).toBe(700 - 180);
    expect(maxHeight).toBeUndefined();
  });

  it("stays below when below is cramped but above is worse", () => {
    // A trigger near the TOP of the window: 40px above it, 120 below.
    const { above, top } = placeMenu({
      trigger: trigger(900, 40),
      menu: { width: 224, height: 400 },
      viewport: { width: 1280, height: 200 },
    });
    expect(above).toBe(false);
    expect(top).toBe(72);
  });

  it("caps a panel too tall for either side and lets it scroll", () => {
    const { above, top, maxHeight } = placeMenu({
      trigger: trigger(900, 500),
      menu: { width: 224, height: 900 },
      viewport: { width: 1280, height: 700 },
    });
    // More room above (500) than below (168), so it flips and scrolls.
    expect(above).toBe(true);
    expect(top).toBe(MENU_GUTTER);
    expect(maxHeight).toBe(500 - MENU_GUTTER);
  });

  it("never reports a negative height for a trigger below the fold", () => {
    const { maxHeight } = placeMenu({
      trigger: trigger(900, 880, 32, 32),
      menu: { width: 224, height: 180 },
      viewport: { width: 1280, height: 900 },
    });
    expect(maxHeight ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("the panel always lands inside the viewport", () => {
  // The whole point of the module, swept rather than spot-checked: wherever
  // the trigger sits, a placed panel must be fully on screen. One test, so a
  // failure names the case that broke instead of burying it in a thousand
  // identical titles.
  it("holds for every trigger position, size and alignment", () => {
    const viewports = [PHONE, DESKTOP, { width: 320, height: 568 }];
    const sizes = [
      { width: 192, height: 120 },
      { width: 224, height: 260 },
    ];
    for (const viewport of viewports) {
      for (const menu of sizes) {
        for (const align of ["left", "right"] as const) {
          for (let x = 0; x <= viewport.width - 32; x += 17) {
            for (let y = 0; y <= viewport.height - 32; y += 23) {
              const p = placeMenu({
                trigger: trigger(x, y),
                menu,
                viewport,
                align,
              });
              const where = `${align} ${menu.width}x${menu.height} at ${x},${y} in ${viewport.width}x${viewport.height}`;
              const height = p.maxHeight ?? menu.height;
              expect({ where, ok: p.left >= MENU_GUTTER }).toEqual({ where, ok: true });
              expect({ where, ok: p.left + menu.width <= viewport.width }).toEqual({ where, ok: true });
              expect({ where, ok: p.top >= 0 }).toEqual({ where, ok: true });
              expect({ where, ok: p.top + height <= viewport.height }).toEqual({ where, ok: true });
            }
          }
        }
      }
    }
  });
});

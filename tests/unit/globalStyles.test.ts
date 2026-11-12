// Unit tests for the app-wide form rules in app/globals.css.
//
// Both rules fix things only a real device shows (iOS native time fields
// overflowing a phone modal; spinner arrows on desktop number boxes), so a
// browser test in CI can't see them break. This reads the sheet instead and
// pins that each rule exists and sits OUTSIDE any @layer, where Tailwind's
// utilities would otherwise beat it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

// The sheet with every @layer block cut out, so a match here is unlayered.
// Walks braces rather than using a regex, since layers nest rules.
function unlayered(sheet: string): string {
  let out = "";
  let i = 0;
  while (i < sheet.length) {
    const at = sheet.indexOf("@layer", i);
    if (at === -1) return out + sheet.slice(i);
    out += sheet.slice(i, at);
    const open = sheet.indexOf("{", at);
    const semi = sheet.indexOf(";", at);
    // `@layer a, b;` is a declaration with no block.
    if (semi !== -1 && (open === -1 || semi < open)) {
      i = semi + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < sheet.length; j++) {
      if (sheet[j] === "{") depth++;
      if (sheet[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

const plain = unlayered(css);

describe("global form rules", () => {
  it("drops the native appearance on date and time fields", () => {
    expect(plain).toMatch(/input\[type="time"\][^{]*\{[^}]*appearance:\s*none/);
    expect(plain).toMatch(/input\[type="date"\][^{]*\{[^}]*min-width:\s*0/);
  });

  it("hides the spinner arrows on every number field", () => {
    expect(plain).toMatch(/input\[type="number"\]\s*\{[^}]*appearance:\s*textfield/);
    expect(plain).toMatch(
      /::-webkit-inner-spin-button[^{]*\{[^}]*-webkit-appearance:\s*none/
    );
    expect(plain).toMatch(/::-webkit-outer-spin-button/);
  });
});

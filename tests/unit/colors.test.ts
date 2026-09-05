import { describe, it, expect } from "vitest";
import { normalizeHex, tintVars, withAlpha } from "@/lib/colors";

describe("normalizeHex", () => {
  it("accepts 6-digit hex with or without the hash, any case", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHex("aabbcc")).toBe("#aabbcc");
    expect(normalizeHex("  #A1B2C3 ")).toBe("#a1b2c3");
  });

  it("expands shorthand", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
  });

  it("rejects anything that isn't a colour", () => {
    expect(normalizeHex("#ab")).toBeNull();
    expect(normalizeHex("#abcdefg")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(123)).toBeNull();
  });
});

describe("withAlpha", () => {
  it("renders an rgba colour at the given strength", () => {
    expect(withAlpha("#aabbcc", 0.1)).toBe("rgba(170, 187, 204, 0.1)");
    expect(withAlpha("abc", 0.5)).toBe("rgba(170, 187, 204, 0.5)");
  });

  it("returns null for a colour it can't parse", () => {
    expect(withAlpha("nope", 0.1)).toBeNull();
  });
});

describe("tintVars", () => {
  it("gives the same colour at a light and a dark strength", () => {
    // Dark mode takes the weaker alpha — the same tint over a near-black card
    // reads much louder than over white.
    expect(tintVars("#aabbcc", 0.2, 0.1)).toEqual({
      "--tint": "rgba(170, 187, 204, 0.2)",
      "--tint-dark": "rgba(170, 187, 204, 0.1)",
    });
  });

  it("is null for anything that isn't a colour, so no style is applied", () => {
    expect(tintVars("", 0.2, 0.1)).toBeNull();
    expect(tintVars("not-a-colour", 0.2, 0.1)).toBeNull();
  });
});

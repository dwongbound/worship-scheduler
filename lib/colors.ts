// Hex colour helpers for the admin's per-set-type tinting (see ColorPicker and
// the generate preview). Colours are stored as plain "#rrggbb" strings, so all
// the app needs is "is this a colour?" and "paint it weakly".

/**
 * "abc" / "#AABBCC" / " #aabbcc " → "#aabbcc", or null when it isn't a colour.
 * Shorthand is expanded so callers only ever deal with the 6-digit form.
 */
export function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(body)) {
    // #abc → #aabbcc
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return /^[0-9a-f]{6}$/.test(body) ? `#${body}` : null;
}

/**
 * "#aabbcc" → "rgba(170, 187, 204, 0.1)". Preview tints are painted weak so
 * the card still reads as a card — the colour identifies the set type without
 * swamping the text on it (in either theme).
 */
export function withAlpha(hex: string, alpha: number): string | null {
  const value = normalizeHex(hex);
  if (!value) return null;
  const channel = (from: number) => parseInt(value.slice(from, from + 2), 16);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${alpha})`;
}

/**
 * The two custom properties a THEMED tint needs: the same colour at a light-
 * mode and a dark-mode strength. The card sets these inline and picks between
 * them in CSS (`bg-[var(--tint)] dark:bg-[var(--tint-dark)]`), so switching
 * theme repaints without React knowing which theme is on — an inline
 * backgroundColor can't do that, it's one value for both.
 *
 * Dark mode wants the weaker of the two: the same alpha over a near-black
 * card reads far louder than over white, and swamps the text on it.
 *
 * Null when `hex` isn't a colour.
 */
export function tintVars(
  hex: string,
  light: number,
  dark: number
): Record<string, string> | null {
  const lightTint = withAlpha(hex, light);
  const darkTint = withAlpha(hex, dark);
  if (!lightTint || !darkTint) return null;
  return { "--tint": lightTint, "--tint-dark": darkTint };
}

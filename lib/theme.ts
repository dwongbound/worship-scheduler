// Theme handling shared by the pre-hydration script (app/layout.tsx) and the
// toggle (components/Navbar.tsx). Three modes:
//   "light"  — force light
//   "dark"   — force dark
//   "system" — follow the OS's prefers-color-scheme, live
// Stored in localStorage under "theme". An absent/invalid value means system.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }
  return "system";
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore write failures
  }
}

// Whether a given mode should render dark *right now*.
export function resolveDark(theme: Theme): boolean {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return theme === "dark";
}

// The phone's status bar / browser chrome colour per scheme. It matches the
// top nav (bg-white / dark:bg-gray-800), which is what sits right under it —
// not the page's gray-50/gray-900, which made a visible seam. app/layout.tsx
// emits one <meta name="theme-color"> per scheme from these.
export const THEME_COLORS = { light: "#FFFFFF", dark: "#1F2937" } as const;

// Point every theme-color meta at the colour this mode actually shows. The
// tags are emitted with a prefers-color-scheme `media` each, which only
// follows the OS — so a forced in-app mode overwrites both, and "system" puts
// each back to its own scheme's colour.
export function syncThemeColor(theme: Theme): void {
  const forced = theme === "system" ? null : THEME_COLORS[theme];
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.getAttribute("media")?.includes("dark") ? "dark" : "light";
    meta.setAttribute("content", forced ?? THEME_COLORS[scheme]);
  });
}

// Add/remove the `dark` class on <html> (Tailwind's class strategy), and
// recolour the status bar to match.
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveDark(theme));
  syncThemeColor(theme);
}

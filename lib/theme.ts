// Theme handling shared by the pre-hydration script (app/layout.tsx) and the
// toggle (components/Navbar.tsx). Three modes:
//   "light"  — force light
//   "dark"   — force dark
//   "system" — follow the OS's prefers-color-scheme, live
// Stored in localStorage under "theme". An absent/invalid value means system.

export type Theme = "light" | "dark" | "system";

export const THEMES: Theme[] = ["light", "dark", "system"];

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

// Add/remove the `dark` class on <html> (Tailwind's class strategy).
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveDark(theme));
}

// Light / dark theme. Follows the system preference until the visitor chooses, then remembers it.
export type Theme = "light" | "dark";

const STORAGE_KEY = "tfg-theme";
// Colour of the browser toolbar on phones (kept in sync with --bg-toolbar in styles.css)
const TOOLBAR_COLOR: Record<Theme, string> = { light: "#0b6fbf", dark: "#10161d" };

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage blocked: follow the system */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}

/** Puts the theme on <html> (CSS reads it) and colours the browser toolbar to match. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", TOOLBAR_COLOR[theme]);
}

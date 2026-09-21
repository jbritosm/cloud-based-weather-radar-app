// Sets the colour theme before the first paint, so a dark-mode visitor never sees a white flash.
// Same rule as src/theme.ts: the saved choice, otherwise the system preference.
//
// This is an external file, not an inline <script>, because the Content Security Policy
// (csp.ts) allows scripts from our own origin only.
try {
  var saved = localStorage.getItem("tfg-theme");
  var theme = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
} catch (error) {
  /* storage blocked: the app itself falls back to the system preference */
}

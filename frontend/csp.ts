// Content Security Policy of the production app: the browser refuses to load or run anything that
// is not listed here, which limits the damage of an injected script or a compromised third party.
// It is injected into index.html by vite.config.ts at build time (not in `npm run dev`, whose
// hot-reload needs inline scripts), so the browser tests and production run under the same policy.
//
// Every external host is one the app really talks to (see layers.ts and MapView.tsx).
const EUMETSAT = "https://view.eumetsat.int"; // satellite tiles, time dimensions, legends
const RAINVIEWER_API = "https://api.rainviewer.com"; // list of radar frames
const RAINVIEWER_TILES = "https://tilecache.rainviewer.com"; // radar tiles
const OPENSTREETMAP = "https://tile.openstreetmap.org"; // base map

export const directives: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Only our own bundled scripts. No inline scripts and no eval: the theme is set by an external
  // file (public/theme-init.js) for exactly this reason.
  "script-src": ["'self'"],
  // 'unsafe-inline' is a known compromise: React and MapLibre set style attributes (the legend's
  // gradient, the map's element sizes). It only affects styles, never scripts.
  "style-src": ["'self'", "'unsafe-inline'"],
  // Tiles and legends are images; MapLibre also builds images from data: and blob: URLs.
  "img-src": ["'self'", "data:", "blob:", OPENSTREETMAP, EUMETSAT, RAINVIEWER_TILES],
  // MapLibre downloads tiles from JavaScript (fetch), which is governed by connect-src.
  "connect-src": ["'self'", EUMETSAT, RAINVIEWER_API, RAINVIEWER_TILES, OPENSTREETMAP],
  // MapLibre runs its tile decoding in web workers created from blob: URLs.
  "worker-src": ["'self'", "blob:"],
  "child-src": ["blob:"],
  "font-src": ["'self'"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

export const contentSecurityPolicy = Object.entries(directives)
  .map(([name, sources]) => `${name} ${sources.join(" ")}`)
  .join("; ");

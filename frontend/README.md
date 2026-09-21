# Frontend

Single-page web application: an interactive map of Spain and Europe with satellite and rain-radar layers, a time animation, legends, and a side panel to choose what to see. Spanish (default) and English.

## Technologies

| Technology | Role | Why this one |
|---|---|---|
| **React 18** | UI library | Component model suits a map + side panels UI, and the ecosystem is the largest. A later mobile app (React Native / Expo) can reuse the knowledge and the same API. |
| **TypeScript** (strict) | Language | Types for the API responses (`api.ts`) catch mismatches between frontend and backend at build time. |
| **Vite 5** | Dev server and bundler | Very fast dev feedback and a simple production build. Chosen over Next.js because no server-side rendering is needed: the app is a static bundle. |
| **MapLibre GL JS** | Map rendering | Open-source, WebGL-based vector/raster map engine with no API key or usage fee (unlike Mapbox GL). Radar output can be drawn as raster or vector layers. |
| **OpenStreetMap raster tiles** | Basemap | Free basemap under the weather data. Fine for a university project; the OSM tile usage policy discourages heavy traffic, so switch provider if load grows. |
| **nginx** | Static file server (in the container) | Serves the compiled files, with an SPA fallback to `index.html`, long cache headers for hashed assets and no-cache for the service worker and HTML. |
| **Service worker + Web App Manifest** | Installable app (PWA) with an offline shell | Gives a "mobile app" from the same code, with no app-store work. Hand-written to keep it small and easy to reason about (about 70 lines). |
| **Vitest** | Unit tests | Same tooling as the build (Vite), fast, and no browser needed for pure logic. |
| **Playwright** | Browser tests | Real Chromium, on desktop and phone sizes; can emulate offline mode, dark mode and touch, and lets us mock every network request. Chosen over Cypress for its multi-project setup and offline/service-worker support. |

## Structure

```
src/
  main.tsx      React entry point
  App.tsx        state and composition: language, active layers, time, URL sync, notices
  LayerPanel.tsx side panel: quick views, grouped layers, opacity, system status, credits
  MapView.tsx    MapLibre map (basemap, satellite + radar layers, geolocation, loading/error events)
  TimeBar.tsx    time control over the map: play/pause, step, slider, "now", local + UTC time
  Legend.tsx     colour scales of the layers that are switched on
  layers.ts      layer definitions, WMS/RainViewer tile URLs, time helpers, quick-view presets
  i18n.ts        Spanish and English texts, language choice
  theme.ts       light/dark theme: system preference, saved choice, applied on <html>
  urlState.ts    reading and writing the shareable link (view, layers, language)
  api.ts         typed fetch helpers: fetchProviders(), fetchProducts()
  styles.css     layout, colour variables (light + dark) and the responsive drawer
  *.test.ts      unit tests (Vitest): layers/time logic, URL state, translations
public/
  manifest.webmanifest   PWA manifest (name, icons, standalone display)
  sw.js                  service worker: installable app + offline shell
  icons/                 app icons (192, 512, maskable, apple-touch, favicon)
e2e/
  mocks.ts               answers every external request (EUMETSAT, RainViewer, OSM, API)
  app.spec.ts            desktop browser tests   mobile.spec.ts   phone tests   pwa.spec.ts   PWA tests
playwright.config.ts     3 projects (desktop, mobile, pwa) against the production build
Dockerfile      multi-stage build (Node build -> nginx)
nginx.conf      SPA routing + cache headers (service worker and HTML never cached)
vite.config.ts  dev proxy: /api -> http://localhost:8000; Vitest settings
```

## How it works

- On load, `App.tsx` calls `GET /api/providers` and `GET /api/products?limit=20` **using relative URLs**. Because the browser only ever talks to one origin (the reverse proxy), there is no CORS configuration and the same build works locally and in AWS.
- `MapView.tsx` creates the MapLibre map in an effect (centered on Spain) and removes it on cleanup (needed with React StrictMode).
- **Satellite layers (EUMETSAT):** Geo Colour (default), infrared (MSG and MTG), Airmass RGB and blended precipitation are drawn straight from EUMETSAT's public **WMS** as raster tiles: no API key, CORS enabled, no backend involved. The user toggles layers and sets their opacity in the sidebar. Notes on the choice: the *Cloud Top Height* layer was dropped because its source grid is about 14 km, so it looks like large blocks when zoomed (server-side smoothing only smears its palette); *True Colour* is empty at night, whereas Geo Colour falls back to infrared and city lights; *Precipitation* is drawn only where rain is detected, so it can look nearly empty on dry days.
- **Time animation:** every layer exposes a WMS `TIME` dimension (`start/end/step`; MSG every 15 min, MTG every 10). `layers.ts` reads it from a small per-layer capabilities document, refreshed every 10 minutes so new images appear on their own. The sidebar offers the last 3 hours in 15-minute steps with a slider and Play/Pause; each layer snaps to its own closest image and never asks for a time in the future (the server answers with an XML error).
- **Rain radar (RainViewer):** a composite of national radars (Spain included) published as ready-made tiles by RainViewer's public API (CORS enabled, attribution shown on the map). It keeps about the last 2 hours in 10-minute steps and takes part in the same time slider: each slider step shows the newest radar image at or before that time, and the layer is hidden for times older than what RainViewer keeps. The free tiles stop at zoom 7, so MapLibre enlarges them beyond that. Third-party terms of use apply: check them before publishing the project. This layer complements the platform's own ingestion (NEXRAD, AEMET); it does not replace it.
- Radar from AEMET would be one more layer once its ingestion is implemented.
- **Usability features:**
  - *Quick views* (Clouds, Rain, Storms) set several layers at once, and "Zoom to Spain" recentres the map.
  - The layer list is grouped (Clouds and satellite / Rain), and every layer has a plain-language description.
  - *Legends* appear for the active layers: EUMETSAT's own colour-scale images for estimated rainfall (mm/h) and high-resolution infrared (°C), and a qualitative weak-to-intense scale for the radar (RainViewer publishes no dBZ table; the colours were sampled from its live tiles). Layers without a published scale (the composites) are described in words instead.
  - The **time bar** sits over the map (play/pause, previous/next, slider, "Now") and shows local time and UTC.
  - **Shareable links:** the map position, zoom, active layers and language are kept in the URL (`?lat=…&lng=…&z=…&layers=…&lang=…`), read once at start and written with `history.replaceState`. Invalid values are ignored. The time is deliberately not in the link, because only the last 3 hours exist.
  - A loading indicator, a toast when a layer fails to load, a geolocation button, and a "System status" panel (data sources and latest ingested products) kept out of the way for ordinary visitors.
  - **Responsive:** on screens up to 800 px the panel becomes a slide-in drawer opened by a "Layers" button, the legend starts collapsed, and the controls stay above the map attribution.
  - **Language:** Spanish by default, with a switch; the choice is remembered in `localStorage`, and `?lang=` overrides it.
  - **Dark mode:** a switch in the panel. It follows the system preference until the visitor chooses, then remembers the choice. All colours are CSS variables that the dark theme redefines; a tiny inline script in `index.html` sets the theme before the first paint (no white flash); the browser toolbar colour follows; the OpenStreetMap basemap is dimmed and desaturated through MapLibre's raster paint properties, while the weather layers are left untouched (their colours carry information); MapLibre's own controls are restyled; and EUMETSAT's legend images (black text on transparent) are kept on a white background so they stay readable.
- **Installable app (PWA):** `manifest.webmanifest` plus icons make the site installable on phones and desktops ("Install app" button, shown when the browser offers it). `sw.js` is a hand-written service worker (no library): at install it caches the app shell (HTML, hashed JS/CSS, icons); page loads go network-first (updates arrive) with the cached shell as the offline fallback; hashed assets are cache-first. It deliberately does **not** touch `/api/*` or any other origin, so live data and weather tiles are never served stale, and offline the app opens but the map has no data (a notice says so). It is registered only in the production build. nginx serves `sw.js` and the HTML with `Cache-Control: no-cache`, the reason a stale worker can never trap users on an old version; hashed assets get a one-year immutable cache.
- The Docker image builds the app in a Node stage and copies only the static output into a small nginx image, so **Node is not needed on the developer machine or on the server**.

## Interacts with

- **Caddy (reverse proxy)**: Caddy serves this container on `/`, and forwards `/api/*` to the backend.
- **Backend API**: read-only JSON over HTTP, through Caddy.
- **OpenStreetMap and EUMETSAT (WMS)**: the browser fetches basemap and satellite tiles directly from them.
- **CI/CD**: `npm ci` and `npm run build` (which also type-checks) run on every push; the image is built from `frontend/Dockerfile`.

## Design decisions

- **Static SPA instead of server-side rendering:** simpler to host, cache and scale; all data comes from the API.
- **No state-management or UI library:** the UI is still small, so plain React state and hand-written CSS are enough (and keep the bundle small). Revisit if the app grows.
- **Own translation table instead of an i18n library:** two languages and a few dozen strings; the `Messages` type makes the compiler check that both languages have every key.
- **Texts are not hard-coded in components**, so adding a language means adding one object in `i18n.ts`.

## Known limitations / next steps

- No AEMET radar layer yet: it needs the AEMET provider (backend) to ingest and expose GeoTIFF radar.
- Only the last 3 hours can be animated (what RainViewer keeps, and what the shared time grid covers).
- The legend for the radar is qualitative, and the Airmass and Geo Colour composites have no numeric scale.
- No pointer inspection yet (click the map to read a value).
- The animation changes the tile URL of each layer, so tiles reload on every step and may flicker briefly; preloading frames as stacked layers would smooth it.
- The satellite layers depend on EUMETSAT's public service being reachable from the user's browser.
- The service worker is not versioned automatically: bump `VERSION` in `sw.js` when its behaviour changes. Offline, the map has no data.
- The production bundle is about 1 MB (mostly MapLibre); code-splitting the map would speed up the first visit.
- The browser tests use mocked services, so they prove the app's logic, not that EUMETSAT or RainViewer are up; the platform's load test covers our own servers.

## Tests

```bash
npm test               # unit tests (Vitest), about 2 s
npm run test:e2e       # browser tests (Playwright), about 40 s: builds the app and serves it
```

- **Unit (27 tests):** the time logic (parsing WMS extents, snapping to each layer's own cadence, never asking for the future), the radar frame selection, the shareable-link parser (including hostile input) and that both languages have exactly the same texts and cover every layer. Writing them found a real bug: `?lat=&lng=&z=` (empty values) was accepted as a view at 0°, 0°, zoom 0.
- **Browser (26 tests, Chromium):** real user flows against the production build, on desktop and on a phone-sized screen: animation play/pause, "Now", layers and quick views, legends, dragging the map, shareable links, language, dark mode (system preference, switch, persistence, legend readability), a failing layer showing a notice, the mobile drawer and that the controls never cover the map attribution, and the PWA (manifest and icons valid, service worker installs, the shell opens **offline**, `/api` and other origins are never cached).
- **Hermetic by design:** `e2e/mocks.ts` answers every external request, so the tests cannot fail because a third-party service is slow or down. The mocks also record the tile requests, which allows checking that stepping back 15 minutes asks the MTG layer (one image every 10 min) for -20 min, the MSG layer (every 15 min) for -15 min, and the radar (every 10 min) for its -20 min frame.
- Both run in CI (`ci.yml`) on every branch and before every deploy of `main`.

## Run without Docker

```bash
npm ci
npm run dev        # http://localhost:5173, needs the API on :8000
npm run build      # type-check + production bundle
```

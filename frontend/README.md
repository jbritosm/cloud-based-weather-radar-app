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
| **nginx** | Static file server (in the container) | Serves the compiled files, with an SPA fallback to `index.html` and long cache headers for hashed assets. |

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
  urlState.ts    reading and writing the shareable link (view, layers, language)
  api.ts         typed fetch helpers: fetchProviders(), fetchProducts()
  styles.css     layout and the responsive drawer for narrow screens
Dockerfile      multi-stage build (Node build -> nginx)
nginx.conf      SPA routing + cache headers
vite.config.ts  dev proxy: /api -> http://localhost:8000
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
- No automated frontend tests in the repository yet. The behaviour was verified with a throwaway headless-browser script (21 checks: animation, layer toggling, shareable links, language, legend, drag, mobile drawer); the next step is to turn it into a Playwright test in CI, plus Vitest for `layers.ts` and `urlState.ts`.

## Run without Docker

```bash
npm ci
npm run dev        # http://localhost:5173, needs the API on :8000
npm run build      # type-check + production bundle
```

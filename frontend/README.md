# Frontend

Single-page web application that shows an interactive map plus the list of data sources and the latest ingested products.

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
  App.tsx       layout: sidebar (providers, products) + map; loads data from the API
  MapView.tsx   MapLibre map (basemap, EUMETSAT overlays, visibility/opacity/time updates)
  layers.ts     EUMETSAT WMS layer list, tile URLs and time-dimension helpers
  api.ts        typed fetch helpers: fetchProviders(), fetchProducts()
  styles.css    layout, responsive for narrow screens
Dockerfile      multi-stage build (Node build -> nginx)
nginx.conf      SPA routing + cache headers
vite.config.ts  dev proxy: /api -> http://localhost:8000
```

## How it works

- On load, `App.tsx` calls `GET /api/providers` and `GET /api/products?limit=20` **using relative URLs**. Because the browser only ever talks to one origin (the reverse proxy), there is no CORS configuration and the same build works locally and in AWS.
- `MapView.tsx` creates the MapLibre map in an effect (centered on Spain) and removes it on cleanup (needed with React StrictMode).
- **Satellite layers (EUMETSAT):** Geo Colour (default), infrared (MSG and MTG), Airmass RGB and blended precipitation are drawn straight from EUMETSAT's public **WMS** as raster tiles: no API key, CORS enabled, no backend involved. The user toggles layers and sets their opacity in the sidebar. Notes on the choice: the *Cloud Top Height* layer was dropped because its source grid is about 14 km, so it looks like large blocks when zoomed (server-side smoothing only smears its palette); *True Colour* is empty at night, whereas Geo Colour falls back to infrared and city lights; *Precipitation* is drawn only where rain is detected, so it can look nearly empty on dry days.
- **Time animation:** every layer exposes a WMS `TIME` dimension (`start/end/step`; MSG every 15 min, MTG every 10). `layers.ts` reads it from a small per-layer capabilities document, refreshed every 10 minutes so new images appear on their own. The sidebar offers the last 3 hours in 15-minute steps with a slider and Play/Pause; each layer snaps to its own closest image and never asks for a time in the future (the server answers with an XML error).
- Radar from AEMET will be added as one more layer once its ingestion is implemented.
- The Docker image builds the app in a Node stage and copies only the static output into a small nginx image, so **Node is not needed on the developer machine or on the server**.

## Interacts with

- **Caddy (reverse proxy)**: Caddy serves this container on `/`, and forwards `/api/*` to the backend.
- **Backend API**: read-only JSON over HTTP, through Caddy.
- **OpenStreetMap and EUMETSAT (WMS)**: the browser fetches basemap and satellite tiles directly from them.
- **CI/CD**: `npm ci` and `npm run build` (which also type-checks) run on every push; the image is built from `frontend/Dockerfile`.

## Design decisions

- **Static SPA instead of server-side rendering:** simpler to host, cache and scale; all data comes from the API.
- **No state-management or UI library yet:** the UI is small, so plain React state is enough. Add them when there are real needs (layer controls, time slider).

## Known limitations / next steps

- No radar layer yet: it needs the AEMET provider (backend) to ingest and expose GeoTIFF radar.
- The animation changes the tile URL of each layer, so tiles reload on every step and may flicker briefly; preloading frames as stacked layers would smooth it.
- The satellite layers depend on EUMETSAT's public service being reachable from the user's browser.
- No automated frontend tests yet (the time helpers were checked with a throwaway script): add Vitest, starting with `layers.ts`.

## Run without Docker

```bash
npm ci
npm run dev        # http://localhost:5173, needs the API on :8000
npm run build      # type-check + production bundle
```

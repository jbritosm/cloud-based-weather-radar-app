// The browser tests never touch the real EUMETSAT, RainViewer, OpenStreetMap or platform API:
// every external request is answered here. Tests are fast, deterministic and cannot fail because a
// third-party service is slow or down. They also record the tile requests, which is how we check
// that the app asks for the right image at the right time.
import { deflateSync } from "node:zlib";
import type { BrowserContext, Route } from "@playwright/test";

const CORS = { "access-control-allow-origin": "*" };
const MIN = 60_000;

/** All times in the mocked world end here: the last 15-minute mark. */
export const NEWEST = Math.floor(Date.now() / (15 * MIN)) * 15 * MIN;
export const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A solid-colour PNG (RGBA), built by hand so no image library is needed. */
export function png(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgba).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface Recorded {
  /** URLs of the satellite (WMS GetMap) tiles requested */
  satellite: string[];
  /** URLs of the RainViewer radar tiles requested */
  radar: string[];
}

/** `time` values requested for one satellite layer, e.g. `timesFor(rec, "mtg_fd:rgb_geocolour")`. */
export function timesFor(recorded: Recorded, layer: string): string[] {
  return recorded.satellite
    .map((u) => new URL(u).searchParams)
    .filter((p) => p.get("layers") === layer)
    .map((p) => p.get("time") ?? "none");
}

export async function mockExternal(context: BrowserContext): Promise<Recorded> {
  const recorded: Recorded = { satellite: [], radar: [] };
  const tile = png(256, 256, [0, 0, 0, 0]);

  // EUMETSAT WMS: capabilities (time dimension), tiles and legends
  await context.route("https://view.eumetsat.int/**", (route: Route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("request");
    if (kind === "GetCapabilities") {
      const step = url.pathname.includes("/mtg_fd/") ? "PT10M" : "PT15M";
      const xml =
        `<?xml version="1.0"?><WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0"><Capability>` +
        `<Layer><Layer><Dimension name="time" units="ISO8601" default="${iso(NEWEST)}">` +
        `2020-01-01T00:00:00.000Z/${iso(NEWEST)}/${step}</Dimension></Layer></Layer></Capability></WMS_Capabilities>`;
      return route.fulfill({ contentType: "text/xml", body: xml, headers: CORS });
    }
    if (kind === "GetMap") {
      recorded.satellite.push(url.toString());
      return route.fulfill({ contentType: "image/png", body: tile, headers: CORS });
    }
    if (kind === "GetLegendGraphic") {
      return route.fulfill({ contentType: "image/png", body: png(200, 24, [120, 120, 120, 255]), headers: CORS });
    }
    return route.abort();
  });

  // RainViewer: 13 frames, 10 minutes apart, the newest at NEWEST
  await context.route("https://api.rainviewer.com/**", (route: Route) => {
    const past = Array.from({ length: 13 }, (_, i) => ({
      time: Math.round((NEWEST - (12 - i) * 10 * MIN) / 1000),
      path: `/v2/radar/f${12 - i}`, // f0 = newest, f12 = oldest
    }));
    return route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ version: "2.0", host: "https://tilecache.rainviewer.com", radar: { past, nowcast: [] } }),
    });
  });
  await context.route("https://tilecache.rainviewer.com/**", (route: Route) => {
    recorded.radar.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: tile, headers: CORS });
  });

  // Basemap
  await context.route("https://tile.openstreetmap.org/**", (route: Route) =>
    route.fulfill({ contentType: "image/png", body: png(256, 256, [200, 210, 200, 255]), headers: CORS }),
  );

  // The platform's own API
  await context.route("**/api/**", (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/providers"
        ? [
            { name: "noaa_nexrad", implemented: true, enabled: true },
            { name: "aemet_radar", implemented: true, enabled: false },
            { name: "eumetsat", implemented: false, enabled: false },
          ]
        : path === "/api/products"
          ? [{ id: 1, provider: "noaa_nexrad", product_type: "level2", observed_at: iso(NEWEST), storage_key: "raw/x" }]
          : {};
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  return recorded;
}

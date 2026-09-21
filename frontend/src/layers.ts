// EUMETSAT publishes its Meteosat products through a public WMS (no API key, CORS enabled),
// so MapLibre can draw them directly as raster tiles. Each layer also exposes a TIME dimension
// ("start/end/step") that lets us request past images and animate them.
const EUMETVIEW = "https://view.eumetsat.int/geoserver";

export type LayerGroup = "satellite" | "rain";

export interface Overlay {
  id: string;
  wmsLayer: string; // "<workspace>:<layer>"
  group: LayerGroup;
}

// Order matters: later entries are drawn on top of earlier ones. Labels and descriptions live in
// i18n.ts, keyed by id.
export const OVERLAYS: Overlay[] = [
  { id: "mtg-geocolour", wmsLayer: "mtg_fd:rgb_geocolour", group: "satellite" },
  { id: "msg-ir108", wmsLayer: "msg_fes:ir108", group: "satellite" },
  { id: "mtg-ir105", wmsLayer: "mtg_fd:ir105_hrfi", group: "satellite" },
  { id: "msg-airmass", wmsLayer: "msg_fes:rgb_airmass", group: "satellite" },
  { id: "msg-precip", wmsLayer: "msg_fes:h60b", group: "rain" },
];

// Rain radar over Spain and the rest of the world: RainViewer publishes a composite of national
// radars as ready-made tiles (free public API, CORS enabled). It keeps about the last 2 hours in
// 10-minute steps. It complements our own ingestion (NEXRAD, AEMET).
export const RAIN_RADAR = { id: "rain-radar", group: "rain" as LayerGroup };

/** Every layer the user can switch, in the order the panel lists them. */
export const UI_LAYERS: { id: string; group: LayerGroup }[] = [
  ...OVERLAYS.map(({ id, group }) => ({ id, group })),
  RAIN_RADAR,
];
export const LAYER_IDS = UI_LAYERS.map((l) => l.id);

export const DEFAULT_ACTIVE = ["mtg-geocolour", RAIN_RADAR.id];

// Quick views: sets of layers that answer a common question.
export const PRESETS: Record<"clouds" | "rain" | "storms", string[]> = {
  clouds: ["mtg-geocolour"],
  rain: ["mtg-geocolour", RAIN_RADAR.id],
  storms: ["msg-ir108", RAIN_RADAR.id],
};

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
// RainViewer's free tiles only come in one palette ("Universal Blue", id 2); other ids are ignored.
const RADAR_COLOR_SCHEME = 2;
export const RADAR_MAX_ZOOM = 7; // the free tiles stop at this zoom: MapLibre enlarges beyond it

// How often we ask the servers for newer images.
export const REFRESH_MS = 10 * 60 * 1000;

// Animation: last 3 hours in 15-minute steps.
export const FRAME_STEP_MS = 15 * 60 * 1000;
export const FRAME_COUNT = 13;

/** Newest image time and cadence of a layer. Times are epoch milliseconds. */
export interface TimeInfo {
  end: number;
  stepMs: number;
}

/** Parses a WMS time extent such as "2020-09-01T00:00:00.000Z/2026-09-21T21:00:00.000Z/PT15M". */
export function parseTimeExtent(extent: string): TimeInfo {
  const interval = extent.trim().split(",").pop() ?? "";
  const [, end, period] = interval.trim().split("/");
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(period ?? "");
  const stepMs = match ? (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000 : 0;
  const endMs = Date.parse(end ?? "");
  if (!stepMs || Number.isNaN(endMs)) throw new Error(`unsupported time extent: ${extent}`);
  return { end: endMs, stepMs };
}

export async function fetchTimeInfo(wmsLayer: string): Promise<TimeInfo> {
  const [workspace, layer] = wmsLayer.split(":");
  // Per-layer capabilities document: ~7 KB instead of the 280 KB global one.
  const url = `${EUMETVIEW}/${workspace}/${layer}/ows?service=WMS&request=GetCapabilities&version=1.3.0`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${wmsLayer}: HTTP ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
  const dimension = Array.from(doc.getElementsByTagName("Dimension")).find(
    (d) => d.getAttribute("name") === "time",
  );
  if (!dimension?.textContent) throw new Error(`${wmsLayer}: no time dimension`);
  return parseTimeExtent(dimension.textContent);
}

/** Latest image of the layer at or before `time`, on the layer's own cadence. */
export function snapToLayer(time: number, info: TimeInfo): number {
  if (time >= info.end) return info.end;
  return info.end - Math.ceil((info.end - time) / info.stepMs) * info.stepMs;
}

/** Tile URL template. `{bbox-epsg-3857}` is filled in by MapLibre for every tile. */
export function wmsTiles(wmsLayer: string, time?: number): string[] {
  const params = [
    "service=WMS",
    "version=1.3.0",
    "request=GetMap",
    `layers=${wmsLayer}`,
    "styles=",
    "format=image/png",
    "transparent=true",
    "crs=EPSG:3857",
    "width=256",
    "height=256",
    "bbox={bbox-epsg-3857}",
  ];
  // Without `time` the server returns its latest image.
  if (time !== undefined) params.push(`time=${new Date(time).toISOString().replace(".000Z", "Z")}`);
  return [`${EUMETVIEW}/ows?${params.join("&")}`];
}

/** Colour-scale image published by EUMETSAT for a layer (only some layers have one). */
export function legendUrl(wmsLayer: string): string {
  return `${EUMETVIEW}/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=${wmsLayer}`;
}

export interface RadarFrame {
  time: number; // epoch ms
  path: string;
}

export interface RadarFrames {
  host: string;
  frames: RadarFrame[]; // oldest first
}

export function parseRadarFrames(data: {
  host: string;
  radar: { past: { time: number; path: string }[] };
}): RadarFrames {
  const frames = data.radar.past
    .map((f) => ({ time: f.time * 1000, path: f.path }))
    .sort((a, b) => a.time - b.time);
  return { host: data.host, frames };
}

export async function fetchRadarFrames(): Promise<RadarFrames> {
  const response = await fetch(RAINVIEWER_API);
  if (!response.ok) throw new Error(`rainviewer: HTTP ${response.status}`);
  return parseRadarFrames(await response.json());
}

/** Newest radar image at or before `time`; null when `time` is older than the first frame. */
export function radarFrameAt(radar: RadarFrames, time: number): RadarFrame | null {
  let found: RadarFrame | null = null;
  for (const frame of radar.frames) if (frame.time <= time) found = frame;
  return found;
}

export function radarTiles(radar: RadarFrames, frame: RadarFrame): string[] {
  return [`${radar.host}${frame.path}/256/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/1_1.png`];
}

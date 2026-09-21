// EUMETSAT publishes its Meteosat products through a public WMS (no API key, CORS enabled),
// so MapLibre can draw them directly as raster tiles. Each layer also exposes a TIME dimension
// ("start/end/step") that lets us request past images and animate them.
const EUMETVIEW = "https://view.eumetsat.int/geoserver";

export interface Overlay {
  id: string;
  label: string;
  wmsLayer: string; // "<workspace>:<layer>"
  note?: string; // short hint shown under the label
}

// Order matters: later entries are drawn on top of earlier ones.
export const OVERLAYS: Overlay[] = [
  {
    id: "mtg-geocolour",
    label: "Geo Colour (MTG)",
    wmsLayer: "mtg_fd:rgb_geocolour",
    note: "True colour by day, infrared and city lights at night.",
  },
  { id: "msg-ir108", label: "Infrared 10.8 µm (MSG)", wmsLayer: "msg_fes:ir108" },
  { id: "mtg-ir105", label: "Infrared 10.5 µm, high resolution (MTG)", wmsLayer: "mtg_fd:ir105_hrfi" },
  {
    id: "msg-airmass",
    label: "Airmass RGB (MSG)",
    wmsLayer: "msg_fes:rgb_airmass",
    note: "Distinguishes air masses; used to follow storm systems.",
  },
  {
    id: "msg-precip",
    label: "Precipitation, blended (MSG)",
    wmsLayer: "msg_fes:h60b",
    note: "Drawn only where rain is detected; light rain is pale.",
  },
];

export const DEFAULT_ACTIVE = ["mtg-geocolour"];

// How often we ask the server for newer images.
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

// Shareable links: the view (position, zoom), the active layers and the language live in the URL,
// e.g. ?lat=43.36&lng=-5.85&z=7&layers=mtg-geocolour,rain-radar&lang=es
import { LAYER_IDS } from "./layers";
import { isLang, type Lang } from "./i18n";

export interface View {
  lat: number;
  lng: number;
  zoom: number;
}

export interface UrlState {
  view?: View;
  layers?: string[];
  lang?: Lang;
}

export const SPAIN_VIEW: View = { lat: 40.2, lng: -3.7, zoom: 5 };

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const state: UrlState = {};

  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("z"));
  if (
    params.has("lat") && params.has("lng") && params.has("z") &&
    inRange(lat, -85, 85) && inRange(lng, -180, 180) && inRange(zoom, 0, 22)
  ) {
    state.view = { lat, lng, zoom };
  }

  // `layers=` (present but empty) means "none"; absent means "use the defaults".
  if (params.has("layers")) {
    const wanted = (params.get("layers") ?? "").split(",").filter(Boolean);
    state.layers = LAYER_IDS.filter((id) => wanted.includes(id));
  }

  const lang = params.get("lang");
  if (isLang(lang)) state.lang = lang;
  return state;
}

export function serializeUrlState(state: { view: View; layers: string[]; lang: Lang }): string {
  const params = new URLSearchParams();
  params.set("lat", state.view.lat.toFixed(3));
  params.set("lng", state.view.lng.toFixed(3));
  params.set("z", state.view.zoom.toFixed(2));
  params.set("layers", state.layers.join(","));
  params.set("lang", state.lang);
  // keep commas readable
  return params.toString().replace(/%2C/g, ",");
}

export function writeUrlState(state: { view: View; layers: string[]; lang: Lang }): void {
  const url = `${window.location.pathname}?${serializeUrlState(state)}`;
  window.history.replaceState(null, "", url);
}

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  LAYER_IDS,
  OVERLAYS,
  RADAR_MAX_ZOOM,
  RAIN_RADAR,
  radarFrameAt,
  radarTiles,
  snapToLayer,
  wmsTiles,
  type RadarFrames,
  type TimeInfo,
} from "./layers";
import type { View } from "./urlState";

// Basemap: OpenStreetMap raster tiles (fine for a university project; switch to a
// proper tile provider if traffic grows). Weather overlays are added as extra layers.
const style: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Mainland Spain and the Balearic Islands (west, south, east, north)
const SPAIN_BOUNDS: maplibregl.LngLatBoundsLike = [
  [-9.6, 35.9],
  [4.6, 43.9],
];

export interface MapHandle {
  flyToSpain: () => void;
}

interface Props {
  activeOverlays: string[];
  opacity: number;
  /** Instant to display (epoch ms); null until the server's available times are known. */
  frameTime: number | null;
  timeInfo: Record<string, TimeInfo>;
  radar: RadarFrames | null;
  initialView: View;
  onViewChange: (view: View) => void;
  onLoadingChange: (loading: boolean) => void;
  onLayerError: () => void;
  onLocateError: () => void;
}

const MapView = forwardRef<MapHandle, Props>(function MapView(props, handle) {
  const { activeOverlays, opacity, frameTime, timeInfo, radar } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const shownTiles = useRef<Record<string, string>>({}); // last tile URL set per overlay
  const [ready, setReady] = useState(false);

  // The map is created once; it calls the latest callbacks through this ref.
  const callbacks = useRef(props);
  callbacks.current = props;

  useImperativeHandle(handle, () => ({
    flyToSpain: () =>
      mapRef.current?.fitBounds(SPAIN_BOUNDS, { padding: { top: 30, bottom: 130, left: 30, right: 30 } }),
  }));

  // Create the map once, with every satellite overlay registered but hidden.
  useEffect(() => {
    if (!container.current) return;
    const { lat, lng, zoom } = callbacks.current.initialView;
    const map = new maplibregl.Map({ container: container.current, style, center: [lng, lat], zoom });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const locate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: false },
    });
    locate.on("error", () => callbacks.current.onLocateError());
    map.addControl(locate, "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      for (const overlay of OVERLAYS) {
        const tiles = wmsTiles(overlay.wmsLayer);
        shownTiles.current[overlay.id] = tiles[0];
        map.addSource(overlay.id, {
          type: "raster",
          tiles,
          tileSize: 256,
          attribution: "© EUMETSAT",
        });
        map.addLayer({
          id: overlay.id,
          type: "raster",
          source: overlay.id,
          layout: { visibility: "none" },
        });
      }
      setReady(true);
    });

    map.on("moveend", () => {
      const center = map.getCenter();
      callbacks.current.onViewChange({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });
    map.on("dataloading", () => callbacks.current.onLoadingChange(true));
    map.on("idle", () => callbacks.current.onLoadingChange(false));
    map.on("error", (event) => {
      // Only tile failures of our weather layers matter to the user
      const sourceId = (event as unknown as { sourceId?: string }).sourceId;
      if (sourceId && LAYER_IDS.includes(sourceId)) callbacks.current.onLayerError();
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Apply visibility, opacity and the selected time whenever the controls change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const overlay of OVERLAYS) {
      const visible = activeOverlays.includes(overlay.id);
      map.setLayoutProperty(overlay.id, "visibility", visible ? "visible" : "none");
      map.setPaintProperty(overlay.id, "raster-opacity", opacity);
      if (!visible) continue;

      // Each layer has its own cadence (MSG 15 min, MTG 10 min): use its closest image.
      const info = timeInfo[overlay.id];
      const time = frameTime !== null && info ? snapToLayer(frameTime, info) : undefined;
      const tiles = wmsTiles(overlay.wmsLayer, time);
      if (shownTiles.current[overlay.id] !== tiles[0]) {
        shownTiles.current[overlay.id] = tiles[0];
        (map.getSource(overlay.id) as maplibregl.RasterTileSource).setTiles(tiles);
      }
    }

    // Rain radar (RainViewer): its own frame list, registered once it has been fetched.
    if (radar && radar.frames.length > 0) {
      const frame =
        frameTime !== null ? radarFrameAt(radar, frameTime) : radar.frames[radar.frames.length - 1];
      const tiles = frame ? radarTiles(radar, frame) : null;
      if (!map.getSource(RAIN_RADAR.id) && tiles) {
        shownTiles.current[RAIN_RADAR.id] = tiles[0];
        map.addSource(RAIN_RADAR.id, {
          type: "raster",
          tiles,
          tileSize: 256,
          maxzoom: RADAR_MAX_ZOOM,
          attribution: "Radar © RainViewer",
        });
        map.addLayer({ id: RAIN_RADAR.id, type: "raster", source: RAIN_RADAR.id });
      }
      if (map.getLayer(RAIN_RADAR.id)) {
        // Hidden when off, or when the selected time is older than the 2 hours it keeps.
        const visible = activeOverlays.includes(RAIN_RADAR.id) && tiles !== null;
        map.setLayoutProperty(RAIN_RADAR.id, "visibility", visible ? "visible" : "none");
        map.setPaintProperty(RAIN_RADAR.id, "raster-opacity", opacity);
        if (tiles && shownTiles.current[RAIN_RADAR.id] !== tiles[0]) {
          shownTiles.current[RAIN_RADAR.id] = tiles[0];
          (map.getSource(RAIN_RADAR.id) as maplibregl.RasterTileSource).setTiles(tiles);
        }
      }
    }
  }, [activeOverlays, opacity, ready, frameTime, timeInfo, radar]);

  return <div ref={container} className="map" />;
});

export default MapView;

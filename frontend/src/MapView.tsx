import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import {
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

interface Props {
  activeOverlays: string[];
  opacity: number;
  /** Instant to display (epoch ms); null until the server's available times are known. */
  frameTime: number | null;
  timeInfo: Record<string, TimeInfo>;
  radar: RadarFrames | null;
}

export default function MapView({ activeOverlays, opacity, frameTime, timeInfo, radar }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const shownTiles = useRef<Record<string, string>>({}); // last tile URL set per overlay
  const [ready, setReady] = useState(false);

  // Create the map once, with every overlay registered but hidden.
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [-3.7, 40.2], // Spain
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
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
}

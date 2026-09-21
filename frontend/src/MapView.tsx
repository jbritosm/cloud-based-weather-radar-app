import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { OVERLAYS, snapToLayer, wmsTiles, type TimeInfo } from "./layers";

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
}

export default function MapView({ activeOverlays, opacity, frameTime, timeInfo }: Props) {
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
  }, [activeOverlays, opacity, ready, frameTime, timeInfo]);

  return <div ref={container} className="map" />;
}

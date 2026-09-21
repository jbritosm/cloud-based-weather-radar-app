import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

// Basemap: OpenStreetMap raster tiles (fine for a university project; switch to a
// proper tile provider if traffic grows). Radar overlays will be added as extra layers.
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

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [-97.5, 36], // Oklahoma: KTLX radar site. Switch to Spain once EUMETSAT/AEMET data exists.
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => map.remove();
  }, []);

  return <div ref={container} className="map" />;
}

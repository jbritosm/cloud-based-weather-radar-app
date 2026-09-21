import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchProducts, fetchProviders, type Product, type Provider } from "./api";
import {
  DEFAULT_ACTIVE,
  FRAME_COUNT,
  FRAME_STEP_MS,
  OVERLAYS,
  REFRESH_MS,
  fetchTimeInfo,
  type TimeInfo,
} from "./layers";
import MapView from "./MapView";

const PLAY_INTERVAL_MS = 1000;

function providerStatus(p: Provider): string {
  if (!p.implemented) return "planned";
  return p.enabled ? "active" : "needs configuration";
}

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeOverlays, setActiveOverlays] = useState<string[]>(DEFAULT_ACTIVE);
  const [opacity, setOpacity] = useState(0.85);
  const [timeInfo, setTimeInfo] = useState<Record<string, TimeInfo>>({});
  const [frameIndex, setFrameIndex] = useState(FRAME_COUNT - 1); // last = latest image
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchProducts()])
      .then(([prov, prod]) => {
        setProviders(prov);
        setProducts(prod);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Which satellite images exist? Asked at start and then periodically, so the newest
  // frame appears without reloading the page.
  const loadTimes = useCallback(async () => {
    const results = await Promise.allSettled(OVERLAYS.map((o) => fetchTimeInfo(o.wmsLayer)));
    const info: Record<string, TimeInfo> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") info[OVERLAYS[i].id] = r.value;
    });
    setTimeInfo(info);
  }, []);

  useEffect(() => {
    void loadTimes();
    const timer = window.setInterval(() => void loadTimes(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadTimes]);

  // Frames end at the newest image available in any layer; layers that lag simply repeat theirs.
  const frames = useMemo(() => {
    const ends = Object.values(timeInfo).map((i) => i.end);
    if (ends.length === 0) return [];
    const newest = Math.max(...ends);
    return Array.from({ length: FRAME_COUNT }, (_, i) => newest - (FRAME_COUNT - 1 - i) * FRAME_STEP_MS);
  }, [timeInfo]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const timer = window.setInterval(
      () => setFrameIndex((i) => (i + 1) % FRAME_COUNT),
      PLAY_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  const toggle = (id: string) =>
    setActiveOverlays((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const frameTime = frames.length > 0 ? frames[frameIndex] : null;
  const isLatest = frameIndex === FRAME_COUNT - 1;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Weather Radar Platform</h1>

        <h2>Satellite layers (EUMETSAT)</h2>
        {OVERLAYS.map((o) => (
          <div key={o.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={activeOverlays.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              {o.label}
            </label>
            {o.note && <small className="note">{o.note}</small>}
          </div>
        ))}
        <label className="check">
          Opacity
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>

        <h2>Time</h2>
        <div className="check">
          <button type="button" disabled={frames.length === 0} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={FRAME_COUNT - 1}
            step={1}
            value={frameIndex}
            disabled={frames.length === 0}
            onChange={(e) => {
              setPlaying(false);
              setFrameIndex(Number(e.target.value));
            }}
          />
        </div>
        <small>
          {frameTime === null
            ? "Loading available times…"
            : `${formatTime(frameTime)}${isLatest ? " (latest)" : ""}. Last 3 hours, 15-minute steps.`}
        </small>

        {error && <p className="error">API error: {error}</p>}

        <h2>Data sources</h2>
        <ul>
          {providers.map((p) => (
            <li key={p.name}>
              {p.name} <span className="tag">{providerStatus(p)}</span>
            </li>
          ))}
        </ul>

        <h2>Latest ingested products</h2>
        {products.length === 0 && !error && <p>Nothing ingested yet.</p>}
        <ul>
          {products.map((p) => (
            <li key={p.id}>
              {p.provider}/{p.product_type}
              <br />
              <small>{new Date(p.observed_at).toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </aside>
      <MapView
        activeOverlays={activeOverlays}
        opacity={opacity}
        frameTime={frameTime}
        timeInfo={timeInfo}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchProducts, fetchProviders, type Product, type Provider } from "./api";
import { initialLang, messages, saveLang, type Lang } from "./i18n";
import LayerPanel from "./LayerPanel";
import Legend from "./Legend";
import {
  DEFAULT_ACTIVE,
  FRAME_COUNT,
  FRAME_STEP_MS,
  OVERLAYS,
  REFRESH_MS,
  fetchRadarFrames,
  fetchTimeInfo,
  type RadarFrames,
  type TimeInfo,
} from "./layers";
import MapView, { type MapHandle } from "./MapView";
import { applyTheme, initialTheme, saveTheme, type Theme } from "./theme";
import TimeBar from "./TimeBar";
import { SPAIN_VIEW, parseUrlState, writeUrlState, type View } from "./urlState";

const PLAY_INTERVAL_MS = 1000;
const NOTICE_MS = 8000;

// Chrome's "install app" event (not in the standard DOM typings)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export default function App() {
  // Link parameters (view, layers, language) are read once, at start
  const initial = useMemo(() => parseUrlState(window.location.search), []);

  const [lang, setLang] = useState<Lang>(() => initialLang(initial.lang));
  const t = messages[lang];
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [activeOverlays, setActiveOverlays] = useState<string[]>(initial.layers ?? DEFAULT_ACTIVE);
  const [view, setView] = useState<View>(initial.view ?? SPAIN_VIEW);
  const [opacity, setOpacity] = useState(0.85);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

  const [timeInfo, setTimeInfo] = useState<Record<string, TimeInfo>>({});
  const [radar, setRadar] = useState<RadarFrames | null>(null);
  const [frameIndex, setFrameIndex] = useState(FRAME_COUNT - 1); // last = latest image
  const [playing, setPlaying] = useState(false);

  const mapRef = useRef<MapHandle>(null);
  const noticeTimer = useRef<number>();

  // Keep the address bar in sync so the current view can be shared
  useEffect(() => writeUrlState({ view, layers: activeOverlays, lang }), [view, activeOverlays, lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appName;
    saveLang(lang);
  }, [lang, t.appName]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  // Offer "install app" when the browser says the page is installable
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault(); // keep it for our own button
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Tell the visitor when the connection drops (the app itself keeps opening from its cache)
  useEffect(() => {
    const onOffline = () => showNotice(t.offline);
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, [showNotice, t.offline]);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchProducts()])
      .then(([prov, prod]) => {
        setProviders(prov);
        setProducts(prod);
      })
      .catch((e: Error) => setApiError(e.message));
  }, []);

  // Which satellite and radar images exist? Asked at start and then periodically, so the newest
  // frame appears without reloading the page.
  const loadTimes = useCallback(async () => {
    const [results, radarFrames] = await Promise.all([
      Promise.allSettled(OVERLAYS.map((o) => fetchTimeInfo(o.wmsLayer))),
      fetchRadarFrames().catch(() => null),
    ]);
    const info: Record<string, TimeInfo> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled") info[OVERLAYS[i].id] = r.value;
    });
    setTimeInfo(info);
    setRadar((previous) => radarFrames ?? previous); // keep the old frames if a refresh fails
  }, []);

  useEffect(() => {
    void loadTimes();
    const timer = window.setInterval(() => void loadTimes(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadTimes]);

  // Frames end at the newest image available in any layer; layers that lag simply repeat theirs.
  const frames = useMemo(() => {
    const ends = Object.values(timeInfo).map((i) => i.end);
    const radarEnd = radar?.frames[radar.frames.length - 1]?.time;
    if (radarEnd !== undefined) ends.push(radarEnd);
    if (ends.length === 0) return [];
    const newest = Math.max(...ends);
    return Array.from(
      { length: FRAME_COUNT },
      (_, i) => newest - (FRAME_COUNT - 1 - i) * FRAME_STEP_MS,
    );
  }, [timeInfo, radar]);

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

  return (
    <div className="layout">
      {panelOpen && <div className="backdrop" onClick={() => setPanelOpen(false)} />}
      <LayerPanel
        t={t}
        lang={lang}
        theme={theme}
        canInstall={installPrompt !== null}
        className={panelOpen ? "open" : ""}
        activeOverlays={activeOverlays}
        opacity={opacity}
        providers={providers}
        products={products}
        apiError={apiError}
        onToggle={toggle}
        onPreset={(ids) => {
          setActiveOverlays(ids);
          setPanelOpen(false);
        }}
        onOpacity={setOpacity}
        onLang={() => setLang((l) => (l === "es" ? "en" : "es"))}
        onTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onInstall={() => {
          void installPrompt?.prompt();
          setInstallPrompt(null); // the browser only allows one prompt per event
        }}
        onGoToSpain={() => {
          mapRef.current?.flyToSpain();
          setPanelOpen(false);
        }}
        onClose={() => setPanelOpen(false)}
      />

      <main className="stage">
        <MapView
          ref={mapRef}
          activeOverlays={activeOverlays}
          opacity={opacity}
          frameTime={frameTime}
          timeInfo={timeInfo}
          radar={radar}
          theme={theme}
          initialView={initial.view ?? SPAIN_VIEW}
          onViewChange={setView}
          onLoadingChange={setMapLoading}
          onLayerError={() => showNotice(t.layerError)}
          onLocateError={() => showNotice(t.locateError)}
        />

        <button type="button" className="panel-toggle" onClick={() => setPanelOpen(true)}>
          ☰ {t.layersButton}
        </button>
        {mapLoading && (
          <div className="pill" role="status">
            <span className="spinner" aria-hidden="true" /> {t.loadingMap}
          </div>
        )}
        {notice && (
          <div className="toast" role="alert">
            {notice}
          </div>
        )}

        <Legend activeOverlays={activeOverlays} t={t} />
        <TimeBar
          frames={frames}
          index={frameIndex}
          playing={playing}
          lang={lang}
          t={t}
          onIndex={setFrameIndex}
          onPlaying={setPlaying}
        />
      </main>
    </div>
  );
}

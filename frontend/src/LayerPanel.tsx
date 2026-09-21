import type { Product, Provider } from "./api";
import type { Lang, Messages } from "./i18n";
import { PRESETS, UI_LAYERS, type LayerGroup } from "./layers";
import type { Theme } from "./theme";

const GROUPS: LayerGroup[] = ["satellite", "rain"];

interface Props {
  t: Messages;
  lang: Lang;
  theme: Theme;
  canInstall: boolean;
  className: string;
  activeOverlays: string[];
  opacity: number;
  providers: Provider[];
  products: Product[];
  apiError: string | null;
  onToggle: (id: string) => void;
  onPreset: (ids: string[]) => void;
  onOpacity: (value: number) => void;
  onLang: () => void;
  onTheme: () => void;
  onInstall: () => void;
  onGoToSpain: () => void;
  onClose: () => void;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export default function LayerPanel(props: Props) {
  const { t, lang, activeOverlays, providers, products } = props;

  const providerStatus = (p: Provider) =>
    !p.implemented ? t.status.planned : p.enabled ? t.status.active : t.status.needsConfig;

  return (
    <aside className={`panel ${props.className}`} aria-label={t.layersButton}>
      <header className="panel-header">
        <div>
          <h1>{t.appName}</h1>
          <p className="muted">{t.tagline}</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="theme"
            onClick={props.onTheme}
            aria-label={props.theme === "dark" ? t.theme.toLight : t.theme.toDark}
            title={props.theme === "dark" ? t.theme.toLight : t.theme.toDark}
          >
            {props.theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            type="button"
            className="lang"
            onClick={props.onLang}
            aria-label={t.languageLabel}
            lang={lang === "es" ? "en" : "es"}
          >
            {t.language}
          </button>
          <button type="button" className="close" onClick={props.onClose} aria-label={t.closePanel}>
            ✕
          </button>
        </div>
      </header>

      <section>
        <h2>{t.quickViews}</h2>
        <div className="chips">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((name) => (
            <button
              key={name}
              type="button"
              className={`chip ${sameSet(activeOverlays, PRESETS[name]) ? "on" : ""}`}
              aria-pressed={sameSet(activeOverlays, PRESETS[name])}
              onClick={() => props.onPreset(PRESETS[name])}
            >
              {t.presets[name]}
            </button>
          ))}
          <button type="button" className="chip" onClick={props.onGoToSpain}>
            {t.goToSpain}
          </button>
          {props.canInstall && (
            <button type="button" className="chip install" onClick={props.onInstall}>
              ⤓ {t.install}
            </button>
          )}
        </div>
      </section>

      {GROUPS.map((group) => (
        <section key={group}>
          <h2>{t.groups[group]}</h2>
          {UI_LAYERS.filter((l) => l.group === group).map((layer) => (
            <div key={layer.id} className="layer">
              <label className="check">
                <input
                  type="checkbox"
                  checked={activeOverlays.includes(layer.id)}
                  onChange={() => props.onToggle(layer.id)}
                />
                <span>
                  {t.layers[layer.id].label}
                  <small className="note">{t.layers[layer.id].note}</small>
                </span>
              </label>
            </div>
          ))}
        </section>
      ))}

      <section>
        <label className="slider-row">
          <span>{t.opacity}</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={props.opacity}
            onChange={(e) => props.onOpacity(Number(e.target.value))}
          />
        </label>
      </section>

      <details className="status">
        <summary>{t.status.title}</summary>
        {props.apiError && (
          <p className="error">
            {t.status.apiError}: {props.apiError}
          </p>
        )}
        <h3>{t.status.sources}</h3>
        <ul>
          {providers.map((p) => (
            <li key={p.name}>
              {p.name} <span className="tag">{providerStatus(p)}</span>
            </li>
          ))}
        </ul>
        <h3>{t.status.products}</h3>
        {products.length === 0 && !props.apiError && <p className="muted">{t.status.none}</p>}
        <ul>
          {products.map((p) => (
            <li key={p.id}>
              {p.provider}/{p.product_type}
              <br />
              <small className="muted">{new Date(p.observed_at).toLocaleString(lang)}</small>
            </li>
          ))}
        </ul>
      </details>

      <footer className="panel-footer">
        <h2>{t.creditsTitle}</h2>
        <ul>
          {t.credits.map((c) => (
            <li key={c.name}>
              <a href={c.url} target="_blank" rel="noreferrer noopener">
                {c.name}
              </a>{" "}
              <span className="muted">{c.what}</span>
            </li>
          ))}
        </ul>
        <p className="muted">{t.footerNote}</p>
      </footer>
    </aside>
  );
}

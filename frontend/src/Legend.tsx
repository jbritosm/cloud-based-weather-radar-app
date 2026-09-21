import { useState } from "react";
import type { Messages } from "./i18n";
import { RAIN_RADAR, legendUrl } from "./layers";

// Colours seen in RainViewer's radar tiles, from weak to intense (sampled from live tiles).
const RADAR_GRADIENT =
  "linear-gradient(90deg, #88ddee, #36bae5, #0088bf, #004a70, #ffee00, #ff9500, #e62800)";

interface Props {
  activeOverlays: string[];
  t: Messages;
}

/** Colour scales of the layers that are switched on. Shows nothing if none of them has one. */
export default function Legend({ activeOverlays, t }: Props) {
  // Open on wide screens; collapsed on phones, where the map needs the room
  const [open, setOpen] = useState(() => !window.matchMedia("(max-width: 800px)").matches);
  const on = (id: string) => activeOverlays.includes(id);
  const showRadar = on(RAIN_RADAR.id);
  const showPrecip = on("msg-precip");
  const showIrHd = on("mtg-ir105");
  const showIr = on("msg-ir108");
  if (!showRadar && !showPrecip && !showIrHd && !showIr) return null;

  return (
    <details className="legend" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t.legend.title}</summary>

      {showRadar && (
        <section>
          <h3>{t.legend.radarTitle}</h3>
          <div className="gradient" style={{ background: RADAR_GRADIENT }} />
          <div className="gradient-labels">
            <span>{t.legend.radarWeak}</span>
            <span>{t.legend.radarIntense}</span>
          </div>
          <small className="muted">{t.legend.radarNote}</small>
        </section>
      )}

      {showPrecip && (
        <section>
          <h3>{t.legend.precipTitle}</h3>
          <img src={legendUrl("msg_fes:h60b")} alt={t.legend.precipTitle} loading="lazy" />
        </section>
      )}

      {showIrHd && (
        <section>
          <h3>{t.legend.irTitle}</h3>
          <img src={legendUrl("mtg_fd:ir105_hrfi")} alt={t.legend.irTitle} loading="lazy" />
        </section>
      )}

      {showIr && !showIrHd && (
        <section>
          <h3>{t.layers["msg-ir108"].label}</h3>
          <small className="muted">{t.legend.irNote}</small>
        </section>
      )}
    </details>
  );
}

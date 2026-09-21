import type { Lang, Messages } from "./i18n";

interface Props {
  frames: number[]; // epoch ms, oldest first (empty until the server's times are known)
  index: number;
  playing: boolean;
  lang: Lang;
  t: Messages;
  onIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
}

export default function TimeBar({ frames, index, playing, lang, t, onIndex, onPlaying }: Props) {
  const ready = frames.length > 0;
  const last = frames.length - 1;
  const current = ready ? frames[index] : null;

  const local =
    current === null
      ? ""
      : new Intl.DateTimeFormat(lang, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(current);
  const utc =
    current === null
      ? ""
      : `${new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(current)} ${t.time.utc}`;

  const step = (delta: number) => {
    onPlaying(false);
    onIndex(Math.min(last, Math.max(0, index + delta)));
  };

  return (
    <div className="timebar" role="group" aria-label={t.time.slider}>
      <div className="timebar-buttons">
        <button type="button" disabled={!ready} onClick={() => step(-1)} aria-label={t.time.previous}>
          ‹
        </button>
        <button
          type="button"
          className="play"
          disabled={!ready}
          onClick={() => onPlaying(!playing)}
          aria-label={playing ? t.time.pause : t.time.play}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" disabled={!ready} onClick={() => step(1)} aria-label={t.time.next}>
          ›
        </button>
      </div>

      <div className="timebar-main">
        <div className="timebar-label">
          {ready ? (
            <>
              <strong>{local}</strong> <span className="muted">{utc}</span>
              {index === last && <span className="badge">{t.time.latest}</span>}
            </>
          ) : (
            <span className="muted">{t.time.loading}</span>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(last, 0)}
          step={1}
          value={ready ? index : 0}
          disabled={!ready}
          aria-label={t.time.slider}
          onChange={(e) => {
            onPlaying(false);
            onIndex(Number(e.target.value));
          }}
        />
        <div className="timebar-ticks" aria-hidden="true">
          <span>{t.time.hoursAgo}</span>
          <span>{t.time.now}</span>
        </div>
      </div>

      <button
        type="button"
        className="now"
        disabled={!ready || index === last}
        onClick={() => {
          onPlaying(false);
          onIndex(last);
        }}
      >
        {t.time.now}
      </button>
    </div>
  );
}

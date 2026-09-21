import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVE,
  LAYER_IDS,
  PRESETS,
  parseRadarFrames,
  parseTimeExtent,
  radarFrameAt,
  radarTiles,
  snapToLayer,
  wmsTiles,
} from "./layers";

const at = (iso: string) => Date.parse(iso);

describe("parseTimeExtent", () => {
  it("reads end and cadence of a WMS time extent", () => {
    const info = parseTimeExtent("2020-09-01T00:00:00.000Z/2026-09-21T21:00:00.000Z/PT15M");
    expect(info.stepMs).toBe(15 * 60_000);
    expect(new Date(info.end).toISOString()).toBe("2026-09-21T21:00:00.000Z");
  });

  it("understands hours and combined periods", () => {
    expect(parseTimeExtent("2020-01-01T00:00:00Z/2026-01-01T00:00:00Z/PT1H").stepMs).toBe(3_600_000);
    expect(parseTimeExtent("2020-01-01T00:00:00Z/2026-01-01T00:00:00Z/PT1H30M").stepMs).toBe(5_400_000);
  });

  it("uses the last interval when there are several", () => {
    const list = "2026-01-01T00:00:00Z/2026-02-01T00:00:00Z/PT1H,2026-03-01T00:00:00Z/2026-03-02T00:00:00Z/PT15M";
    expect(parseTimeExtent(list).stepMs).toBe(15 * 60_000);
  });

  it("rejects extents it cannot use", () => {
    expect(() => parseTimeExtent("2026-01-01T00:00:00Z,2026-01-02T00:00:00Z")).toThrow();
    expect(() => parseTimeExtent("a/b/PT15M")).toThrow();
  });
});

describe("snapToLayer", () => {
  const msg = parseTimeExtent("2020-01-01T00:00:00Z/2026-09-21T21:00:00Z/PT15M");
  const mtg = parseTimeExtent("2020-01-01T00:00:00Z/2026-09-21T21:00:00Z/PT10M");

  it("keeps a time that is on the layer's grid", () => {
    expect(snapToLayer(at("2026-09-21T20:45:00Z"), msg)).toBe(at("2026-09-21T20:45:00Z"));
  });

  it("falls back to the newest image at or before the time", () => {
    expect(snapToLayer(at("2026-09-21T20:45:00Z"), mtg)).toBe(at("2026-09-21T20:40:00Z"));
    expect(snapToLayer(at("2026-09-21T20:44:59Z"), msg)).toBe(at("2026-09-21T20:30:00Z"));
  });

  it("never asks for a time after the newest image", () => {
    expect(snapToLayer(at("2026-09-22T00:00:00Z"), msg)).toBe(msg.end);
  });
});

describe("wmsTiles", () => {
  it("builds a GetMap template with MapLibre's bbox token", () => {
    const [url] = wmsTiles("msg_fes:ir108", at("2026-09-21T20:45:00Z"));
    expect(url).toContain("layers=msg_fes:ir108");
    expect(url).toContain("bbox={bbox-epsg-3857}");
    expect(url).toContain("time=2026-09-21T20:45:00Z");
  });

  it("omits the time to ask for the latest image", () => {
    expect(wmsTiles("msg_fes:ir108")[0]).not.toContain("time=");
  });
});

describe("rain radar frames", () => {
  const radar = parseRadarFrames({
    host: "https://h",
    radar: {
      past: [
        { time: 1000, path: "/v2/radar/b" },
        { time: 400, path: "/v2/radar/a" },
        { time: 1600, path: "/v2/radar/c" },
      ],
    },
  });

  it("sorts frames oldest first and converts seconds to milliseconds", () => {
    expect(radar.frames.map((f) => f.path)).toEqual(["/v2/radar/a", "/v2/radar/b", "/v2/radar/c"]);
    expect(radar.frames[0].time).toBe(400_000);
  });

  it("picks the newest frame at or before a time", () => {
    expect(radarFrameAt(radar, 1_100_000)?.path).toBe("/v2/radar/b");
    expect(radarFrameAt(radar, 99_999_999)?.path).toBe("/v2/radar/c");
  });

  it("returns null when the time is older than everything it keeps", () => {
    expect(radarFrameAt(radar, 100_000)).toBeNull();
  });

  it("builds the tile template of a frame", () => {
    expect(radarTiles(radar, radar.frames[2])[0]).toBe("https://h/v2/radar/c/256/{z}/{x}/{y}/2/1_1.png");
  });
});

describe("layer definitions", () => {
  it("only reference known layers in the defaults and quick views", () => {
    for (const id of [...DEFAULT_ACTIVE, ...Object.values(PRESETS).flat()]) {
      expect(LAYER_IDS).toContain(id);
    }
  });

  it("have unique ids", () => {
    expect(new Set(LAYER_IDS).size).toBe(LAYER_IDS.length);
  });
});

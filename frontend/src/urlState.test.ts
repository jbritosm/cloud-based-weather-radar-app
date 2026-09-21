import { describe, expect, it } from "vitest";
import { SPAIN_VIEW, parseUrlState, serializeUrlState } from "./urlState";

describe("parseUrlState", () => {
  it("reads a complete link", () => {
    const state = parseUrlState("?lat=43.36&lng=-5.85&z=7&layers=mtg-geocolour,rain-radar&lang=en");
    expect(state.view).toEqual({ lat: 43.36, lng: -5.85, zoom: 7 });
    expect(state.layers).toEqual(["mtg-geocolour", "rain-radar"]);
    expect(state.lang).toBe("en");
  });

  it("returns nothing for an empty link, so the defaults apply", () => {
    expect(parseUrlState("")).toEqual({});
  });

  it("treats an empty layers parameter as 'no layers' but a missing one as 'default'", () => {
    expect(parseUrlState("?layers=").layers).toEqual([]);
    expect(parseUrlState("?lang=es").layers).toBeUndefined();
  });

  it("drops unknown layers and keeps the known ones", () => {
    expect(parseUrlState("?layers=nope,rain-radar,__proto__").layers).toEqual(["rain-radar"]);
  });

  it("ignores a view that is incomplete, not numeric or out of range", () => {
    expect(parseUrlState("?lat=43&lng=-5").view).toBeUndefined();
    expect(parseUrlState("?lat=abc&lng=1&z=5").view).toBeUndefined();
    expect(parseUrlState("?lat=95&lng=1&z=5").view).toBeUndefined();
    expect(parseUrlState("?lat=40&lng=181&z=5").view).toBeUndefined();
    expect(parseUrlState("?lat=40&lng=1&z=999").view).toBeUndefined();
    expect(parseUrlState("?lat=&lng=&z=").view).toBeUndefined();
  });

  it("ignores an unsupported language", () => {
    expect(parseUrlState("?lang=fr").lang).toBeUndefined();
  });
});

describe("serializeUrlState", () => {
  it("round-trips through parseUrlState", () => {
    const state = { view: { lat: 43.361, lng: -5.85, zoom: 7 }, layers: ["msg-ir108", "rain-radar"], lang: "es" as const };
    const parsed = parseUrlState(`?${serializeUrlState(state)}`);
    expect(parsed.view?.lat).toBeCloseTo(43.361, 3);
    expect(parsed.view?.zoom).toBeCloseTo(7, 2);
    expect(parsed.layers).toEqual(state.layers);
    expect(parsed.lang).toBe("es");
  });

  it("keeps commas readable and can express 'no layers'", () => {
    const text = serializeUrlState({ view: SPAIN_VIEW, layers: ["msg-ir108", "rain-radar"], lang: "en" });
    expect(text).toContain("layers=msg-ir108,rain-radar");
    expect(parseUrlState(`?${serializeUrlState({ view: SPAIN_VIEW, layers: [], lang: "en" })}`).layers).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { isLang, messages } from "./i18n";
import { LAYER_IDS } from "./layers";

/** The structure of a value with the texts replaced by their type. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]));
  }
  return typeof value;
}

describe("translations", () => {
  it("have exactly the same structure in both languages", () => {
    expect(shape(messages.es)).toEqual(shape(messages.en));
  });

  it("describe every layer in both languages", () => {
    for (const lang of ["es", "en"] as const) {
      for (const id of LAYER_IDS) {
        expect(messages[lang].layers[id]?.label, `${lang}: ${id}`).toBeTruthy();
        expect(messages[lang].layers[id]?.note, `${lang}: ${id}`).toBeTruthy();
      }
    }
  });

  it("have no empty texts", () => {
    const empty: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string" && value.trim() === "") empty.push(path);
      else if (value !== null && typeof value === "object") {
        Object.entries(value).forEach(([key, inner]) => walk(inner, `${path}.${key}`));
      }
    };
    walk(messages, "messages");
    expect(empty).toEqual([]);
  });

  it("recognises supported languages only", () => {
    expect(isLang("es")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});
